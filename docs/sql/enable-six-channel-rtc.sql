-- Apply through Lovable after the existing seven-round medicine migration and its owner_id repair.
-- Existing history is preserved. New hardware schedules use channels 1–6.
BEGIN;

CREATE OR REPLACE FUNCTION public.set_box_channel_schedule(
  _device_id uuid, _box_slot text, _time time
)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_owner uuid;
BEGIN
  SELECT d.owner_id INTO v_owner FROM public.devices d WHERE d.id = _device_id AND d.mode = 'real';
  IF auth.uid() IS NULL OR v_owner IS NULL OR NOT public.can_access(v_owner) THEN
    RAISE EXCEPTION 'Box not accessible';
  END IF;
  IF _box_slot NOT IN ('morning_before','morning_after','afternoon_before','afternoon_after','evening_before','evening_after')
     OR _box_slot IS NULL OR _time IS NULL THEN
    RAISE EXCEPTION 'Invalid channel or time';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_device_id::text, 0));
  UPDATE public.medication_schedules s SET dose_time = _time
  FROM public.medicines m WHERE m.id = s.medicine_id AND m.device_id = _device_id
    AND m.owner_id = v_owner AND s.owner_id = v_owner AND s.box_slot = _box_slot AND s.ends_on IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_six_box_medicine(
  _medicine_id uuid, _medicine jsonb, _rounds jsonb
)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_saved uuid; v_box uuid; v_old_box uuid; v_lock uuid; v_round jsonb;
BEGIN
  v_box := NULLIF(_medicine ->> 'device_id', '')::uuid;
  SELECT m.device_id INTO v_old_box FROM public.medicines m WHERE m.id = _medicine_id;
  FOR v_lock IN SELECT DISTINCT x FROM unnest(ARRAY[v_box, v_old_box]) x WHERE x IS NOT NULL ORDER BY x LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(v_lock::text, 0));
  END LOOP;
  IF v_box IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(_rounds) r
    WHERE r ->> 'box_slot' = 'bedtime'
  ) THEN RAISE EXCEPTION 'This box has six compartments. Bedtime cannot be assigned to it'; END IF;
  v_saved := public.save_box_medicine(_medicine_id, _medicine, _rounds);
  IF v_box IS NOT NULL THEN
    FOR v_round IN SELECT value FROM jsonb_array_elements(_rounds) LOOP
      PERFORM public.set_box_channel_schedule(v_box, v_round ->> 'box_slot', (v_round ->> 'dose_time')::time);
    END LOOP;
  END IF;
  RETURN v_saved;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_box_compartment(
  _device_id uuid, _compartment integer, _date date
)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_owner uuid; v_timezone text; v_today date; v_slot text; v_count integer; v_matched integer;
BEGIN
  IF _compartment NOT BETWEEN 1 AND 6 OR _compartment IS NULL OR _date IS NULL THEN
    RAISE EXCEPTION 'Invalid compartment or date';
  END IF;
  SELECT d.owner_id, COALESCE(p.timezone, 'Asia/Bangkok') INTO v_owner, v_timezone
  FROM public.devices d LEFT JOIN public.profiles p ON p.id = d.owner_id
  WHERE d.id = _device_id AND d.mode = 'real' FOR UPDATE OF d;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Unknown real box'; END IF;
  v_today := (now() AT TIME ZONE v_timezone)::date;
  IF _date > v_today THEN RAISE EXCEPTION 'Confirmation date is in the future'; END IF;
  v_slot := (ARRAY['morning_before','morning_after','afternoon_before','afternoon_after','evening_before','evening_after'])[_compartment];
  WITH eligible AS MATERIALIZED (
    SELECT s.id AS schedule_id, m.id AS medicine_id, s.slot
    FROM public.medication_schedules s JOIN public.medicines m ON m.id = s.medicine_id
    WHERE m.device_id = _device_id AND m.owner_id = v_owner AND s.owner_id = v_owner AND m.active
      AND s.box_slot = v_slot AND (s.ends_on IS NULL OR s.ends_on > _date)
      AND extract(dow FROM _date)::integer = ANY(s.days_of_week)
      AND (s.created_at AT TIME ZONE v_timezone) <= (_date + s.dose_time)
  ), inserted AS (
    INSERT INTO public.dose_logs(owner_id, schedule_id, medicine_id, scheduled_date, slot, source, device_id)
    SELECT v_owner, e.schedule_id, e.medicine_id, _date, e.slot, 'device', _device_id
    FROM eligible e ON CONFLICT DO NOTHING RETURNING medicine_id
  ), quantities AS (
    SELECT medicine_id, count(*) AS doses FROM inserted GROUP BY medicine_id
  ), decremented AS (
    UPDATE public.medicines m SET quantity = greatest(0, m.quantity - (m.pills_per_dose * q.doses)::integer)
    FROM quantities q WHERE m.id = q.medicine_id RETURNING m.id
  )
  SELECT count(*), (SELECT count(*) FROM eligible) INTO v_count, v_matched FROM inserted;
  IF v_matched = 0 THEN RETURN -1; END IF;
  IF v_count > 0 THEN
    INSERT INTO public.device_events(device_id, owner_id, event_type, payload, source)
    VALUES (_device_id, v_owner, 'dose_confirmed',
      jsonb_build_object('compartment', _compartment, 'scheduled_date', _date, 'medicines', v_count), 'real');
  END IF;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.set_box_channel_schedule(uuid,text,time),
  public.save_six_box_medicine(uuid,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_box_channel_schedule(uuid,text,time),
  public.save_six_box_medicine(uuid,jsonb,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.confirm_box_compartment(uuid,integer,date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_box_compartment(uuid,integer,date) TO service_role;
COMMIT;
