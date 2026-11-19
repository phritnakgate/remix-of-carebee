-- Apply in the CareBee remix through Lovable.
-- This installs storage and delivery functions. Schedule activation is a separate script.
BEGIN;

CREATE TABLE IF NOT EXISTS public.mqtt_background_configs (
  device_id uuid PRIMARY KEY REFERENCES public.devices(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES public.profiles(id),
  enabled boolean NOT NULL DEFAULT false,
  enabled_at timestamptz NOT NULL DEFAULT now(),
  settings jsonb NOT NULL CHECK (jsonb_typeof(settings) = 'object'),
  last_checked_at timestamptz,
  last_published_at timestamptz,
  last_error text
);
CREATE INDEX IF NOT EXISTS mqtt_background_enabled
  ON public.mqtt_background_configs(device_id) WHERE enabled;

CREATE TABLE IF NOT EXISTS public.mqtt_deliveries (
  device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  schedule_id uuid NOT NULL REFERENCES public.medication_schedules(id) ON DELETE CASCADE,
  scheduled_date date NOT NULL,
  payload text NOT NULL CHECK (char_length(payload) BETWEEN 1 AND 4096),
  token uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('sending', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 1,
  lease_until timestamptz NOT NULL,
  sent_at timestamptz,
  PRIMARY KEY (device_id, schedule_id, scheduled_date)
);

CREATE TABLE IF NOT EXISTS public.mqtt_job_state (
  id text PRIMARY KEY CHECK (id = 'default'),
  token_hash text NOT NULL,
  last_tick_at timestamptz,
  last_run_at timestamptz
);

ALTER TABLE public.mqtt_background_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mqtt_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mqtt_job_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mqtt_background_configs, public.mqtt_deliveries, public.mqtt_job_state
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.mqtt_background_configs, public.mqtt_deliveries, public.mqtt_job_state TO service_role;

-- The same selector is used by the cheap timer and by the sender to claim work.
CREATE OR REPLACE FUNCTION public.mqtt_due_items()
RETURNS TABLE(device_id uuid, schedule_id uuid, scheduled_date date)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT c.device_id, s.id, local_time.at::date
  FROM public.mqtt_background_configs AS c
  JOIN public.devices AS d ON d.id = c.device_id AND d.owner_id = c.owner_id AND d.mode = 'real'
  JOIN public.medicines AS m ON m.owner_id = c.owner_id AND m.active
    AND (m.device_id = c.device_id OR m.device_id IS NULL)
  JOIN public.medication_schedules AS s ON s.medicine_id = m.id AND s.owner_id = c.owner_id
  LEFT JOIN public.profiles AS p ON p.id = c.owner_id
  CROSS JOIN generate_series(0, 2) AS minutes_ago(n)
  CROSS JOIN LATERAL (
    SELECT date_trunc('minute', now()) - minutes_ago.n * interval '1 minute' AS at
  ) AS candidate
  CROSS JOIN LATERAL (
    SELECT candidate.at AT TIME ZONE COALESCE(p.timezone, 'Asia/Bangkok') AS at
  ) AS local_time
  WHERE c.enabled AND s.notify
    AND c.enabled_at <= candidate.at
    AND s.created_at <= candidate.at
    AND s.dose_time >= local_time.at::time
    AND s.dose_time - local_time.at::time < interval '1 minute'
    AND extract(dow FROM local_time.at)::integer = ANY(s.days_of_week)
    AND (s.ends_on IS NULL OR s.ends_on > local_time.at::date)
    AND (m.device_id IS NOT NULL OR (
      s.box_slot IS NULL AND (
        c.settings -> 'medicineIds' IS NULL OR c.settings -> 'medicineIds' = 'null'::jsonb
        OR c.settings -> 'medicineIds' @> jsonb_build_array(m.id::text)
      )
    ))
    AND NOT EXISTS (
      SELECT 1 FROM public.dose_logs AS l
      WHERE l.schedule_id = s.id AND l.scheduled_date = local_time.at::date
        AND l.owner_id = c.owner_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.mqtt_deliveries AS sent
      WHERE sent.device_id = c.device_id AND sent.schedule_id = s.id
        AND sent.scheduled_date = local_time.at::date
        AND (sent.status = 'sent' OR sent.attempts >= 3 OR (
          sent.status = 'sending' AND sent.lease_until > now()
        ))
    );
$$;

CREATE OR REPLACE FUNCTION public.mqtt_due_boxes()
RETURNS TABLE(device_id uuid)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT items.device_id
  FROM (SELECT DISTINCT i.device_id FROM public.mqtt_due_items() AS i) AS items
  JOIN public.mqtt_background_configs AS c ON c.device_id = items.device_id
  ORDER BY c.last_checked_at ASC NULLS FIRST, items.device_id
  LIMIT 100;
$$;

CREATE OR REPLACE FUNCTION public.claim_mqtt_delivery(
  _device_id uuid, _schedule_id uuid, _date date, _payload text, _token uuid, _settings jsonb
)
RETURNS TABLE(payload text)
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path = public
AS $$
  INSERT INTO public.mqtt_deliveries AS delivery (
    device_id, schedule_id, scheduled_date, payload, token, status, lease_until
  )
  SELECT _device_id, _schedule_id, _date, _payload, _token, 'sending', now() + interval '45 seconds'
  FROM public.mqtt_due_items() AS due
  WHERE due.device_id = _device_id AND due.schedule_id = _schedule_id AND due.scheduled_date = _date
    AND EXISTS (
      SELECT 1 FROM public.mqtt_background_configs AS c
      WHERE c.device_id = _device_id AND c.enabled AND c.settings = _settings
    )
  ON CONFLICT (device_id, schedule_id, scheduled_date) DO UPDATE
    SET token = EXCLUDED.token, status = 'sending',
        lease_until = EXCLUDED.lease_until, attempts = delivery.attempts + 1
    WHERE delivery.status <> 'sent' AND delivery.attempts < 3
      AND (delivery.status = 'failed' OR delivery.lease_until <= now())
  RETURNING delivery.payload;
$$;

CREATE OR REPLACE FUNCTION public.finish_mqtt_delivery(
  _device_id uuid, _schedule_id uuid, _date date, _token uuid, _success boolean
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  did_update boolean;
BEGIN
  UPDATE public.mqtt_deliveries AS delivery
  SET status = CASE WHEN _success THEN 'sent' ELSE 'failed' END,
      sent_at = CASE WHEN _success THEN now() ELSE NULL END,
      lease_until = now()
  WHERE delivery.device_id = _device_id AND delivery.schedule_id = _schedule_id
    AND delivery.scheduled_date = _date AND delivery.token = _token AND delivery.status = 'sending';
  did_update := FOUND;
  IF did_update AND _success THEN
    UPDATE public.mqtt_background_configs AS c
    SET last_published_at = now(), last_error = NULL
    WHERE c.device_id = _device_id;
  END IF;
  RETURN did_update;
END;
$$;

REVOKE ALL ON FUNCTION public.mqtt_due_items(), public.mqtt_due_boxes(),
  public.claim_mqtt_delivery(uuid, uuid, date, text, uuid, jsonb),
  public.finish_mqtt_delivery(uuid, uuid, date, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mqtt_due_items(), public.mqtt_due_boxes(),
  public.claim_mqtt_delivery(uuid, uuid, date, text, uuid, jsonb),
  public.finish_mqtt_delivery(uuid, uuid, date, uuid, boolean) TO service_role;

COMMIT;
