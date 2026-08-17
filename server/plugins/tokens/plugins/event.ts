import { registerTokenPlugin } from "../registry";

/**
 * Root: {{event...}} — the entity the fired event is about, for
 * token-templated event notifiers. The produced entity kind is dynamic:
 * the notifier that renders the template builds the event entity (and
 * declares its kind), and the chain advances to that kind after this
 * segment (`dynamicOutput`). Outside a notifier render (bulk messages,
 * previews) there is no event entity and the chain resolves as missing;
 * bulk-messaging validation excludes this root entirely, so `{{event.…}}`
 * is an unknown token there.
 */
registerTokenPlugin({
  metadata: {
    id: "token.event",
    name: "Event",
    description: "The record the triggering event is about (event notifiers only)",
    segmentName: "event",
    inputTypes: ["root"],
    outputType: "event",
    dynamicOutput: true,
    hiddenFromCatalog: true,
  },
  async resolve(_entity, _args, ctx) {
    // The event root is the seeded root named for the render's event
    // kind: whoever renders declares the kind and seeds the record.
    return (ctx.eventKind ? ctx.roots[ctx.eventKind] : undefined) ?? null;
  },
});
