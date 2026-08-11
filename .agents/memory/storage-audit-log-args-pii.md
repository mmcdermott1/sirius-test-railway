---
name: Storage audit log args PII
description: Logged storage methods persist raw call args into winston_logs; use logArgs/shouldLog hooks.
---

The storage logging middleware persists each logged method's full `args` array verbatim into the `winston_logs` table (`meta.args`), on success AND error paths.

**Why:** Enabling logging on `upsertSession` would have stored the entire express/passport session payload (identity, possibly provider tokens) in audit logs — flagged as a serious leak in review.

**How to apply:** When enabling logging on any method whose args carry payloads (session data, credentials, big blobs), set the per-method `logArgs: (args) => [...projected]` projection to redact them. Use `shouldLog: (args, result) => boolean` for conditional logging (e.g. upserts that log only on insert — detect insert via `RETURNING (xmax = 0)`). Both hooks live in `MethodLoggingConfig`.

Also: prune-style "scan candidates then delete" loops must re-qualify the predicate atomically in the DELETE (`WHERE id = X AND still-expired`), or a row renewed between scan and delete gets wrongly removed.
