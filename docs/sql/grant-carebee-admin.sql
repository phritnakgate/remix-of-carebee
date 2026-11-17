-- Replace the placeholder with the User ID from Lovable's Users view.
-- Run this in the SQL editor of the CareBee remix.
UPDATE auth.users
SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
                       || '{"carebee_admin":true}'::jsonb
WHERE id = '<USER_UUID>'::uuid
RETURNING id;
