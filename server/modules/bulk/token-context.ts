import type { IStorage } from "../../storage";

/**
 * Inspect each contactId and report which token scopes (root segment
 * names) apply to the audience. `contact` and `system` always apply.
 * `worker` applies if any contact is a worker; `employer` applies if
 * any contact resolves to an employer (via worker or employer-contact
 * link). Used to filter the token catalog for a specific message.
 */
export async function detectAudienceScopes(
  storage: IStorage,
  contactIds: string[],
): Promise<Set<string>> {
  const scopes = new Set<string>(["contact", "system"]);
  if (contactIds.length === 0) return scopes;

  const workerRows = await storage.bulkTokens.countWorkerContacts(contactIds);
  if (workerRows.length > 0) {
    scopes.add("worker");
    if (workerRows.some((w) => w.homeEmployerId || (w.employerIds && w.employerIds.length > 0))) {
      scopes.add("employer");
    }
  }

  if (!scopes.has("employer")) {
    if (await storage.bulkTokens.hasAnyEmployerContact(contactIds)) {
      scopes.add("employer");
    }
  }

  return scopes;
}
