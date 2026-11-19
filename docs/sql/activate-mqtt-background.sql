-- Run AFTER enable-mqtt-background.sql and after the app is deployed.
-- Confirm this is the CareBee remix database. Use its published app URL below.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

DO $setup$
DECLARE
  sender_token text;
BEGIN
  SELECT secret.decrypted_secret INTO sender_token
  FROM vault.decrypted_secrets AS secret WHERE secret.name = 'carebee_mqtt_job_token';
  IF sender_token IS NULL THEN
    sender_token := encode(extensions.gen_random_bytes(32), 'hex');
    PERFORM vault.create_secret(sender_token, 'carebee_mqtt_job_token', 'CareBee scheduled MQTT sender');
  END IF;
  INSERT INTO public.mqtt_job_state(id, token_hash)
  VALUES ('default', encode(extensions.digest(sender_token, 'sha256'), 'hex'))
  ON CONFLICT (id) DO UPDATE SET token_hash = EXCLUDED.token_hash;
END;
$setup$;

CREATE OR REPLACE FUNCTION public.dispatch_mqtt_reminders()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $dispatch$
BEGIN
  UPDATE public.mqtt_job_state SET last_tick_at = now() WHERE id = 'default';
  IF EXISTS (SELECT 1 FROM public.mqtt_due_items()) THEN
    PERFORM net.http_post(
      url := 'https://carebee-copy.lovable.app/api/jobs/mqtt',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          SELECT secret.decrypted_secret FROM vault.decrypted_secrets AS secret
          WHERE secret.name = 'carebee_mqtt_job_token'
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 45000
    );
  END IF;
END;
$dispatch$;

REVOKE ALL ON FUNCTION public.dispatch_mqtt_reminders() FROM PUBLIC, anon, authenticated;
SELECT cron.schedule(
  'carebee-mqtt-reminders', '* * * * *', 'SELECT public.dispatch_mqtt_reminders();'
);
COMMIT;
