-- Apply through Lovable to enable shared ESP32 mapping in /admin.
BEGIN;

CREATE TABLE IF NOT EXISTS public.mqtt_sensor_templates (
  id text PRIMARY KEY CHECK (id = 'default'),
  template text NOT NULL CHECK (char_length(template) BETWEEN 1 AND 4096)
);

ALTER TABLE public.mqtt_sensor_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mqtt_sensor_templates FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mqtt_sensor_templates TO service_role;

COMMIT;
