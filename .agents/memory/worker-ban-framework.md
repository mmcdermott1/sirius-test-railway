---
name: Worker-ban framework conventions
description: Durable rules for configurable ban types and behavior plugins
---

- Ban types are option rows whose data multi-selects singleton behavior plugins; `worker_bans.type` is a soft reference (no FK) validated at write time and delete-guarded.
  **Why:** avoids risky enum/FK migrations while keeping types admin-configurable.
- Only UNCONDITIONAL dispatch-accept behaviors produce global denorm ban facts; conditional behaviors (facility, job type) are enforced only at the acceptance point check. **How to apply:** any new accept/write path for dispatches must run the shared ban-rejection check — a status write route that skips it is a ban bypass.
- Editing a ban type's behaviors changes every existing ban of that type; any surface mutating ban-type semantics must re-emit the ban-saved event per referencing ban so denorm recomputes immediately (daily sweep is too slow).
- A manifest-only plugin kind (no config adapter) still needs entries in the client PluginKind union AND the per-kind search-params map, or tsc fails.
- Conditional ban context (e.g. a job's facility) must be an authoritative persisted field with server-side validation — a ban behavior whose context is never populated silently never matches.
- Standalone scripts exercising component-gated plugins must load the component cache first or all gated plugins appear disabled.
- `worker_bans.denorm_active` is owned by the `worker_ban_active` denorm plugin (endDate-window cache; enforcement never reads it). Nothing else may write it; date rollovers repair via the hourly denorm backfill, and a flag flip re-emits the ban-saved event AFTER COMMIT so worker dispatch facts recompute.
