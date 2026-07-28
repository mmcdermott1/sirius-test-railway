---
name: Shared access-policy → server hook injection
description: How shared/access-policies files reach server-only registries without importing server code
---

Shared access-policy modules are bundled into the client, so they must never
import server registries. When a policy needs server-side context (e.g.
`file.read` granting via the entity-files context's own access callback),
expose an injectable resolver setter in the shared file and wire it at boot
from a small server file (called in `server/routes.ts` next to the related
route registration).

**Why:** direct import would pull server code into the client bundle; an
unset resolver must fail closed so client/standalone evaluation grants
nothing extra.

**How to apply:** shared file: `set<X>Resolver(fn)` + null default, branch
only grants when resolver returns true. Server wiring: look up registry,
gate on `ctx.isComponentEnabled(component)`, call a req-free
`checkPolicyAccess(verb, entityId, ctx)` twin of the route's `checkAccess`
(keep them exactly as strict as each other), catch → deny.
