ALTER TABLE public.medicines
  ADD COLUMN device_id uuid REFERENCES public.devices(id) ON DELETE SET NULL;

ALTER TABLE public.medication_schedules
  ADD COLUMN box_slot text,
  ADD COLUMN ends_on date;

ALTER TABLE public.medication_schedules
  ADD CONSTRAINT medication_schedules_box_slot_check
  CHECK (box_slot IS NULL OR box_slot IN (
    'morning_before', 'morning_after',
    'afternoon_before', 'afternoon_after',
    'evening_before', 'evening_after', 'bedtime'
  ));

ALTER TABLE public.medication_schedules
  DROP CONSTRAINT medication_schedules_medicine_id_slot_key;

CREATE UNIQUE INDEX medication_schedules_legacy_active_unique
  ON public.medication_schedules (medicine_id, slot)
  WHERE box_slot IS NULL AND ends_on IS NULL;

CREATE UNIQUE INDEX medication_schedules_box_round_active_unique
  ON public.medication_schedules (medicine_id, box_slot)
  WHERE box_slot IS NOT NULL AND ends_on IS NULL;

CREATE OR REPLACE FUNCTION public.guard_medicine_device_assignment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  assigned_owner uuid;
  assigned_mode public.device_mode;
BEGIN
  IF NEW.device_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT d.owner_id, d.mode
    INTO assigned_owner, assigned_mode
    FROM public.devices AS d
   WHERE d.id = NEW.device_id;

  IF NOT FOUND OR assigned_owner IS DISTINCT FROM NEW.owner_id OR assigned_mode <> 'real'::public.device_mode THEN
    RAISE EXCEPTION 'Medicine box must be a real box belonging to the medicine owner';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER medicines_guard_device_assignment
BEFORE INSERT OR UPDATE OF device_id, owner_id ON public.medicines
FOR EACH ROW EXECUTE FUNCTION public.guard_medicine_device_assignment();

CREATE OR REPLACE FUNCTION public.guard_medication_schedule_owner()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  medicine_owner uuid;
BEGIN
  SELECT m.owner_id INTO medicine_owner
    FROM public.medicines AS m
   WHERE m.id = NEW.medicine_id;

  IF NOT FOUND OR medicine_owner IS DISTINCT FROM NEW.owner_id THEN
    RAISE EXCEPTION 'Medication schedule owner must match medicine owner';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER medication_schedules_guard_owner
BEFORE INSERT OR UPDATE OF medicine_id, owner_id ON public.medication_schedules
FOR EACH ROW EXECUTE FUNCTION public.guard_medication_schedule_owner();

CREATE OR REPLACE FUNCTION public.save_box_medicine(
  _medicine_id uuid,
  _medicine jsonb,
  _rounds jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  owner_id uuid;
  saved_id uuid;
  existing_owner uuid;
  box_id uuid;
  timezone_name text;
  today_owner date;
  item jsonb;
  raw_slot text;
  mapped_slot public.time_slot;
  round_time time without time zone;
  desired_slots text[] := ARRAY[]::text[];
  selected_ids uuid[] := ARRAY[]::uuid[];
  chosen_id uuid;
  chosen_days smallint[];
  chosen_notify boolean;
  existing_round record;
  current_round record;
  parsed_quantity integer;
  parsed_pills integer;
  parsed_compartment integer;
  parsed_active boolean;
  parsed_food public.food_instruction;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;
  IF jsonb_typeof(_medicine) <> 'object' THEN
    RAISE EXCEPTION 'Medicine details must be an object';
  END IF;
  IF jsonb_typeof(_rounds) <> 'array' OR jsonb_array_length(_rounds) < 1 OR jsonb_array_length(_rounds) > 7 THEN
    RAISE EXCEPTION 'Choose between one and seven medicine rounds';
  END IF;

  BEGIN
    owner_id := (_medicine ->> 'owner_id')::uuid;
    parsed_quantity := COALESCE((_medicine ->> 'quantity')::integer, 0);
    parsed_pills := COALESCE((_medicine ->> 'pills_per_dose')::integer, 1);
    parsed_active := COALESCE((_medicine ->> 'active')::boolean, true);
    parsed_food := COALESCE((_medicine ->> 'food_instruction')::public.food_instruction, 'after_food'::public.food_instruction);
    IF NULLIF(_medicine ->> 'compartment', '') IS NOT NULL THEN
      parsed_compartment := (_medicine ->> 'compartment')::integer;
    END IF;
    IF NULLIF(_medicine ->> 'device_id', '') IS NOT NULL THEN
      box_id := (_medicine ->> 'device_id')::uuid;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Invalid medicine details';
  END;

  IF owner_id IS NULL OR NOT public.can_access(owner_id) THEN
    RAISE EXCEPTION 'You cannot access this medicine owner';
  END IF;
  IF NULLIF(btrim(_medicine ->> 'name'), '') IS NULL OR length(btrim(_medicine ->> 'name')) > 80 THEN
    RAISE EXCEPTION 'Medicine name is required and must be 80 characters or less';
  END IF;
  IF parsed_quantity < 0 OR parsed_pills < 1 OR (parsed_compartment IS NOT NULL AND parsed_compartment NOT BETWEEN 1 AND 28) THEN
    RAISE EXCEPTION 'Invalid medicine quantity, pills per dose, or compartment';
  END IF;
  IF length(COALESCE(_medicine ->> 'dosage', '')) > 40 OR length(COALESCE(_medicine ->> 'notes', '')) > 300 THEN
    RAISE EXCEPTION 'Medicine details are too long';
  END IF;

  IF box_id IS NOT NULL THEN
    PERFORM 1 FROM public.devices AS d
     WHERE d.id = box_id AND d.owner_id = owner_id AND d.mode = 'real'::public.device_mode;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Choose a real medicine box belonging to this medicine owner';
    END IF;
  END IF;

  IF _medicine_id IS NULL THEN
    INSERT INTO public.medicines (
      owner_id, name, dosage, quantity, pills_per_dose, food_instruction,
      compartment, color, notes, active, device_id
    ) VALUES (
      owner_id, btrim(_medicine ->> 'name'), NULLIF(btrim(_medicine ->> 'dosage'), ''),
      parsed_quantity, parsed_pills, parsed_food, parsed_compartment,
      COALESCE(NULLIF(btrim(_medicine ->> 'color'), ''), 'blue'),
      NULLIF(btrim(_medicine ->> 'notes'), ''), parsed_active, box_id
    ) RETURNING id INTO saved_id;
  ELSE
    SELECT m.owner_id INTO existing_owner
      FROM public.medicines AS m
     WHERE m.id = _medicine_id
     FOR UPDATE;
    IF NOT FOUND OR existing_owner IS DISTINCT FROM owner_id OR NOT public.can_access(existing_owner) THEN
      RAISE EXCEPTION 'Medicine not found or not accessible';
    END IF;
    UPDATE public.medicines AS m SET
      name = btrim(_medicine ->> 'name'),
      dosage = NULLIF(btrim(_medicine ->> 'dosage'), ''),
      quantity = parsed_quantity,
      pills_per_dose = parsed_pills,
      food_instruction = parsed_food,
      compartment = parsed_compartment,
      color = COALESCE(NULLIF(btrim(_medicine ->> 'color'), ''), 'blue'),
      notes = NULLIF(btrim(_medicine ->> 'notes'), ''),
      active = parsed_active,
      device_id = box_id
    WHERE m.id = _medicine_id
    RETURNING m.id INTO saved_id;
  END IF;

  SELECT COALESCE(p.timezone, 'Asia/Bangkok') INTO timezone_name
    FROM public.profiles AS p WHERE p.id = owner_id;
  timezone_name := COALESCE(timezone_name, 'Asia/Bangkok');
  today_owner := (now() AT TIME ZONE timezone_name)::date;

  FOR item IN SELECT value FROM jsonb_array_elements(_rounds) LOOP
    IF jsonb_typeof(item) <> 'object' THEN
      RAISE EXCEPTION 'Each round must be an object';
    END IF;
    raw_slot := item ->> 'box_slot';
    IF raw_slot NOT IN (
      'morning_before', 'morning_after', 'afternoon_before', 'afternoon_after',
      'evening_before', 'evening_after', 'bedtime'
    ) THEN
      RAISE EXCEPTION 'Unknown medicine round';
    END IF;
    IF raw_slot = ANY(desired_slots) THEN
      RAISE EXCEPTION 'Medicine rounds cannot be duplicated';
    END IF;
    IF COALESCE(item ->> 'dose_time', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
      RAISE EXCEPTION 'Round time must use 24-hour HH:MM format';
    END IF;
    desired_slots := array_append(desired_slots, raw_slot);
  END LOOP;

  SELECT s.id, s.days_of_week, s.notify
    INTO existing_round
    FROM public.medication_schedules AS s
   WHERE s.medicine_id = saved_id AND s.box_slot IS NULL AND s.ends_on IS NULL
   ORDER BY s.created_at, s.id
   LIMIT 1
   FOR UPDATE;

  FOR item IN SELECT value FROM jsonb_array_elements(_rounds) LOOP
    raw_slot := item ->> 'box_slot';
    round_time := (item ->> 'dose_time')::time without time zone;
    mapped_slot := CASE
      WHEN raw_slot IN ('morning_before', 'morning_after') THEN 'morning'::public.time_slot
      WHEN raw_slot IN ('afternoon_before', 'afternoon_after') THEN 'afternoon'::public.time_slot
      WHEN raw_slot IN ('evening_before', 'evening_after') THEN 'evening'::public.time_slot
      ELSE 'bedtime'::public.time_slot
    END;
    chosen_id := NULL;
    chosen_days := ARRAY[0,1,2,3,4,5,6]::smallint[];
    chosen_notify := true;

    SELECT s.id, s.days_of_week, s.notify
      INTO current_round
      FROM public.medication_schedules AS s
     WHERE s.medicine_id = saved_id AND s.box_slot = raw_slot AND s.ends_on IS NULL
       AND NOT (s.id = ANY(selected_ids))
     ORDER BY s.created_at, s.id
     LIMIT 1
     FOR UPDATE;
    IF FOUND THEN
      chosen_id := current_round.id;
      chosen_days := current_round.days_of_week;
      chosen_notify := current_round.notify;
    ELSE
      SELECT s.id, s.days_of_week, s.notify
        INTO current_round
        FROM public.medication_schedules AS s
       WHERE s.medicine_id = saved_id AND s.box_slot IS NULL AND s.ends_on IS NULL
         AND s.slot = mapped_slot AND NOT (s.id = ANY(selected_ids))
       ORDER BY s.created_at, s.id
       LIMIT 1
       FOR UPDATE;
      IF FOUND THEN
        chosen_id := current_round.id;
        chosen_days := current_round.days_of_week;
        chosen_notify := current_round.notify;
      END IF;
    END IF;

    IF chosen_id IS NULL THEN
      INSERT INTO public.medication_schedules (
        owner_id, medicine_id, slot, dose_time, days_of_week, notify, box_slot
      ) VALUES (
        owner_id, saved_id, mapped_slot, round_time, chosen_days, chosen_notify, raw_slot
      ) RETURNING id INTO chosen_id;
    ELSE
      UPDATE public.medication_schedules AS s SET
        slot = mapped_slot, dose_time = round_time, box_slot = raw_slot
      WHERE s.id = chosen_id;
    END IF;
    selected_ids := array_append(selected_ids, chosen_id);
  END LOOP;

  IF cardinality(selected_ids) > 0 THEN
    UPDATE public.medication_schedules AS s
       SET ends_on = today_owner
     WHERE s.medicine_id = saved_id AND s.ends_on IS NULL
       AND NOT (s.id = ANY(selected_ids));
  END IF;

  RETURN saved_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.box_schedule_version()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT CASE WHEN auth.uid() IS NOT NULL THEN 1 ELSE 0 END;
$$;

REVOKE ALL ON FUNCTION public.save_box_medicine(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_box_medicine(uuid, jsonb, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.box_schedule_version() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.box_schedule_version() TO authenticated;