---
name: Token plugin framework
description: Chained token ({{contact.address(primary="true").field(name="street")}}) plugin system conventions and gotchas.
---

- Legacy flat token ids ({{contact.firstName}}) parse as valid chains under the new grammar, so stored templates never need migration; any new leaf must keep this property (register under both `contact` and `worker` input types for name-like leaves).
- Audience gating is FAIL-CLOSED: a plugin declaring `metadata.audiences` resolves as missing unless the eval context carries an allowed audience. Delivery paths pass `audience: "email"|"sms"|"inapp"|"postal"`; preview/coverage intentionally pass none and degrade to defaults.
  **Why:** review flagged that gate-only-when-audience-present silently leaks restricted data everywhere.
  **How to apply:** any new render call site must decide its audience explicitly; don't "fix" empty output by removing the gate.
- Evaluator must enforce the same arg contract as shared `validateChain` (unknown args rejected server-side), or warnings/coverage disagree with send behavior.
- Standalone tsx scripts exercising the token system must import `storage` from `server/storage/database` (NOT the `server/storage` barrel) and run from inside the workspace, else barrel init cycles / module resolution break.
