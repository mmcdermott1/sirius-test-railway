---
name: Token plugin framework
description: Chained token ({{contact.address(primary="true").field(name="street")}}) plugin system conventions and gotchas.
---

- REVERSED (2026-08-15 by user decision): legacy flat token ids ({{contact.firstName}}) are now intentionally INVALID — no aliasing, old templates break by design. Fields are read generically via one `field(name=…)` leaf (inputTypes `["*"]`); no PII allowlist (template authors are privileged); derived data = relation segments (worker.bargaining_unit.field(name="name")); field names validate against the live Drizzle schema (per-entity field catalog shipped to client), raw-string fallback for open entity types. Entity plugins resolve `{kind,row,table?}` full rows; FK values auto-render referenced `name` column.
- Drizzle hazard: interpolating `${table.col}` inside a `sql``\` fragment used in `.select({...})` renders an UNQUALIFIED bare `"id"` — correlated subqueries silently mis-correlate and return NULL. Spell correlations as literal qualified identifiers (`"workers"."id"`).
- Audience gating is FAIL-CLOSED: a plugin declaring `metadata.audiences` resolves as missing unless the eval context carries an allowed audience. Delivery paths pass `audience: "email"|"sms"|"inapp"|"postal"`; preview/coverage intentionally pass none and degrade to defaults.
  **Why:** review flagged that gate-only-when-audience-present silently leaks restricted data everywhere.
  **How to apply:** any new render call site must decide its audience explicitly; don't "fix" empty output by removing the gate.
- Evaluator must enforce the same arg contract as shared `validateChain` (unknown args rejected server-side), or warnings/coverage disagree with send behavior.
- Standalone tsx scripts exercising the token system must import `storage` from `server/storage/database` (NOT the `server/storage` barrel) and run from inside the workspace, else barrel init cycles / module resolution break.
