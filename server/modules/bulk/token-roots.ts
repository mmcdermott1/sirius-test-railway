import { CONTACT_ROOT_NAME } from "../../plugins/tokens/plugins/contact";
import { WORKER_ROOT_NAME } from "../../plugins/tokens/plugins/worker";
import { SYSTEM_ROOT_NAME } from "../../plugins/tokens/plugins/system";
import { EMPLOYER_ROOT_NAME } from "../../plugins/tokens/plugins/employer";

/**
 * The roots a bulk message's tokens may start from — the whole list,
 * stated here once so the catalog, the browsable tree, the coverage
 * check and the postal merge variables cannot drift apart.
 *
 * A bulk message is a LIST OF CONTACTS. That is the entire subject of
 * the thing: the author picked recipients, and every token they write
 * is answered per recipient at delivery.
 *
 * - `contact` — the recipient. The message is about these people.
 * - `worker` — the recipient's worker record, for the recipients that
 *   have one. Delivery resolves it from the recipient, so it is a
 *   second way of saying "the person receiving this", not a second
 *   subject.
 * - `system` — dates and site values, seedless and identical for every
 *   recipient.
 *
 * `employer` is deliberately NOT here. The employer root is only ever
 * resolved from the recipient's worker, so as a root of its own it
 * offered a picker of arbitrary employers this message has never heard
 * of. An author who wants the recipient's employer writes it the way
 * delivery reads it — `{{worker.home_employer}}` — which says whose
 * employer it is.
 */
export const BULK_TOKEN_ROOT_NAMES = [
  CONTACT_ROOT_NAME,
  WORKER_ROOT_NAME,
  SYSTEM_ROOT_NAME,
];

/**
 * The roots behind the merge variables a postal send hands to Lob.
 *
 * Lob templates are authored in Lob, not here, so this list is a
 * contract with a system we cannot read: a key we stop supplying is a
 * hole in somebody's letter, discovered on delivery. It therefore keeps
 * `employer` — those keys resolve from the recipient's worker exactly as
 * they always did — even though bulk no longer OFFERS an employer root
 * to authors writing here. Restricting what an author may write is an
 * editor decision; withdrawing a key from a live template is not, and
 * that is a separate, deliberate change to make with Lob's templates in
 * front of you.
 */
export const BULK_POSTAL_MERGE_ROOT_NAMES = [
  ...BULK_TOKEN_ROOT_NAMES,
  EMPLOYER_ROOT_NAME,
];
