---
name: In-app env overrides
description: Rules for the DB-backed environment-variable override framework (/config/env, env_overrides variables row)
---

- Precedence: real `process.env` presence is `!== undefined` (empty string counts as SET and wins over any override). Getter, `isEnvironmentVariableSetInProcess`, and `listEnvironmentVariables` must all use the same rule.
- Non-overridable (enforced in isEnvironmentVariableOverridable): explicit denylist (DB/session/boot escape hatches) + `platform` category + prefixes AUTH_/LOCAL_AUTH_/OKTA_/SAML_/OAUTH_/CLERK_/VITE_CLERK_/SESSION_/DB_. **Why:** an admin DB write persisting across restarts could silently redirect auth/token traffic or swap provider trust credentials — auth bootstrap is deploy-pipeline-only by security review.
- `env_overrides` is an internal aggregate variable: generic /api/variables writes are 403-blocked (GENERIC_WRITE_BLOCKED in modules/system/variables.ts) and generic reads are redacted via the registry `redactRead` hook. All mutation goes through /api/admin/env under an in-process write lock reading fresh from DB (never the cache).
- Boot-time-only consumers (auth providers, FILESYSTEMS, sessions) need an app restart to see override changes; overrides load in bootstrapApp right after migrations.
