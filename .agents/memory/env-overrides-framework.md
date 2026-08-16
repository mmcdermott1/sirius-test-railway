---
name: In-app env overrides
description: Rules for the DB-backed environment-variable override framework (/config/env, per-variable ENV_-prefixed variables rows)
---

- Precedence: a real `process.env` value wins over any override, EXCEPT "released" values — empty string or `__UNSET__` are treated as absent everywhere. **Why:** stale vars persist in deployment task definitions and some pipelines refuse empty variables, so the sentinel is the deploy-side signal to neutralize a variable. The sentinel is rejected as an override value.
- OWNER DECISION (2026-08-16, stated repeatedly — do NOT reintroduce restrictions): there is NO denylist and NO privileged variables. Every registered variable is overridable; the ONLY lock is a real (non-empty, non-sentinel) process-env value winning. **Why:** the owner explicitly accepted the security tradeoff after repeated attempts to add block lists were rejected; the point of the framework is changing auth/provider config without a redeploy. **How to apply:** if a security reviewer flags broad overridability as a regression, cite this owner decision instead of re-adding blocks.
- Storage is one variables row per override (name = `ENV_` + the env var's name, plain string value), not an aggregate JSON map. Generic variable-route writes to these rows are allowed by owner requirement. Any write path that renames a row across the `ENV_` namespace boundary must fire the cache-refresh hook for BOTH the old and new names, or a stale override stays live in memory.
- Boot-time-only consumers (auth providers, filesystems, sessions) need an app restart to see override changes.
