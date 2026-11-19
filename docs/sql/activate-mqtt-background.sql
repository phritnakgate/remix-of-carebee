-- Prepares storage for Lovable's managed Jobs. This SQL does not register a job.
-- Ask Lovable to create the job using the prompt in docs/mqtt-background-setup.th.md.
-- Run after enable-mqtt-background.sql in the CareBee remix database.
BEGIN;
INSERT INTO public.mqtt_job_state(id, token_hash)
VALUES ('default', '')
ON CONFLICT (id) DO NOTHING;
COMMIT;

SELECT last_tick_at, last_run_at
FROM public.mqtt_job_state WHERE id = 'default';
