-- Migration: Migrate existing users with replit_user_id to auth_identities table
-- This should be run once on each environment (dev, production) after adding the auth_identities table

INSERT INTO auth_identities (user_id, provider_type, external_id, email)
SELECT id, 'replit', replit_user_id, email
FROM users
WHERE replit_user_id IS NOT NULL
AND NOT EXISTS (
  SELECT 1 FROM auth_identities 
  WHERE auth_identities.user_id = users.id 
  AND auth_identities.provider_type = 'replit'
  AND auth_identities.external_id = users.replit_user_id
);
