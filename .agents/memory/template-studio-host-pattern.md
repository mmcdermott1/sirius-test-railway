---
name: Template Studio host pattern
description: How tokenized-template editing surfaces plug into the shared TemplateStudio dialog
---

The reusable full-screen editor is `client/src/components/template-studio/TemplateStudio.tsx`; hosts supply fields/values, a `fetchPreview(values)` call, a `previewContextKey`, and a `contextPanel` ReactNode.

**Rules learned:**
- Hosts must normalize preview payloads: notifier preview returns `{rendered}` per field, bulk preview returns `{output}`.
- RJSF widgets can't edit sibling fields directly — GenericConfigDialog exposes `updateConfigData(path, value)` via `formContext` (typed in `SchemaFormContext`), and the studio deep-sets `templates.<channel>.<key>`.
- Event-scoped token catalogs come from `buildTokenCatalogForEvent(kind)`: the `event` root and per-kind relation plugins are `hiddenFromCatalog`, so the event-root walk uses the FULL registry, not the visible subset.
- Notifier "real record" preview = optional `tokenTemplates.previewEntities {search,load}`; preview endpoint takes `eventEntityId` and must set `sample:false` when a real entity/contact is present. Payload-snapshot notifiers (dispatch-status, grievance, edls) can't offer it.
- `SimpleHtmlEditor` exposes `editorApiRef.insertText()` for external insert-at-cursor (saves the rich-mode Range on blur/keyup/click because focus moves to the token browser before insert).
