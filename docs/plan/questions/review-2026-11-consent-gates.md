# Review 2026-11 — consent to be public, and unknown life status — questions for the owner

Fix PR "consent" of round 2 of the 2026-11-13 review (`docs/adr/0031-consent-and-living-gates.md`). The two rules below are **decisions the owner took on 2026-11-14** and are built as decided. The work did not stop on the questions on this page: it continued with the proposed defaults, each marked `DEFAULT D03` or `DEFAULT review-2026-11` in the code. The owner changes a default by answering here; the change is then a small follow-up.

## Decided by the owner on 2026-11-14 (built as decided, nothing to answer)

1. **DEFAULT D03.** A member who leaves "Show my profile publicly" unticked is not public. No consent record also means not public.
2. **A person whose life status is "unknown" is treated as living** and stays hidden until the claim shows otherwise (the evidence shows the person is deceased).

## 2026-11-14 — Consent: what "granted" means, and the members who are public today without a record

**Question:** the rule "public only while the latest `publication` consent is a grant" needs a few exact readings. Which ones do we take, and what happens to the members who are public now without any consent record?

**Proposed defaults (all of it; `src/server/services/publication.ts`, marked `DEFAULT D03`):**
- **The latest record decides** (ties on the time broken by the row id, as everywhere), of any document version. A new version of the privacy notice asks the member again but does not undo their choice: an older grant still counts.
- **No backfill.** Existing accounts are not changed: the rule reads the consent. A member who is public today without a record (an old profile made before consent was recorded) stays public until they change it themselves, so nobody's profile disappears on the day of the release. What changes is that **no later approval can publish** a person who has no grant. Option: a one-off step that hides every public member without a grant. It is a single `UPDATE`, but it would make today's public profiles vanish, so it was not done without your word.
- **A person without an account** (a historical teacher, an invited record) has no consent to read. A verified link publishes it as before, subject to the life-status rule. See the next question for why this matters.
- **The member turns it on** at `/account/privacy` or in the profile settings, as today. Turning it on records the grant, publishes the own profile and, where links are already verified, they appear too. Turning it off hides at once.
- **A held record that staff put back** (ADR 0030) returns to what its owner chose, and now only when the owner has a granted consent: a member who was public without any record (see the first bullet) and is taken down and restored comes back private until they tick the box. Option: let the restore skip the consent check for them.
- **A verified link whose end is private stays verified and private**, and the people are told so (notification, e-mail, the student request form, the teacher approval page and both dashboards): calm wording, no shaming, "it becomes public when both people have chosen Show my profile publicly". They see the link on their dashboard (Your teachers / Student requests). Option: ask the private person once more, by notification, to consider making their profile public. Not built: it would be a nudge to publish.

**Answer:** (filled in by the owner)

## 2026-11-14 — People who have no account

**Question:** a verified link publishes a record that has no account without asking anyone, because there is nobody to ask. Is that right?

**Proposed default:** yes, and in practice it concerns only historical records. A link is verified by the teacher's own approval (the teacher has an account by then: an invited living teacher claims the record first) or by the committee for a historical claim, and that path accepts only a historical record or one established as deceased. So the only people published without a consent record are the historical masters of the archive, and the life-status rule (below) now keeps out any of them whose death is not established. If you want the rule written down in the code as well, it is one line in `PERSON_MAY_BE_PUBLIC` (`p.claimed_by_user_id IS NULL AND p.kind = 'historical'`); it is not needed today and was not added.

**Answer:** (filled in by the owner)

## 2026-11-14 — Unknown life status: the evidence, the choice, and what becomes of existing public records

**Question:** "unknown" is the default for a historical teacher a claimant has not said is deceased. How is it settled, and what happens to public records that already have this status?

**Proposed defaults (all of it; marked `DEFAULT review-2026-11`):**
- **In the database.** `CHECK person_unknown_not_public`: a record with an unknown life status cannot be public, whichever code path writes it. The migration first hides the records that are public with that status (an audit row each, ids and shapes only, no actor; their `lineage_membership` rows are removed), and corrects held (taken down) records so a restore cannot bring them back. Demo records are unaffected: the generator already gives `deceased` to the historical masters and `living` to everybody else.
- **In the verify panel** (an archivist or an administrator with the second factor; a moderator cannot verify a claim): when the claimed teacher is "unknown", verifying asks a required plain choice: **"The evidence shows this person is deceased"** (a written reason that cites the evidence is required, up to 2000 characters; the record becomes `deceased` and is published if the link and the other end allow) or **"I cannot establish this"** (the claim may still be verified; the record stays hidden). Without a choice the decision is refused. The audit row of the decision carries `lifeStatus`, `deathEstablished` and the evidence ids; never the reason text.
- **Archival edit.** Only an archivist can set a record from unknown to deceased there: a reason **and at least one piece of evidence** (linked or uploaded for the edit) are required, and the record is published if it already has an established link. A public record cannot be set to unknown (hide it first). A proposal cannot ask for "unknown".
- **The claim form** tells the claimant that a person whose status is not known is not shown publicly until the committee has established that they have died; the claim can still be confirmed.
- **Record revision.** The establishing step writes a `record_revision` row with source `archival_edit` and the review case, like any archival edit. A separate source ("committee") would mean a migration; it was not worth one.
- **Not built:** a bulk tool to find and settle unknown records; the list of hidden unknown records is the archivist's search.

**Answer:** (filled in by the owner)

## 2026-11-14 — Privacy notice (out of scope here; what the code now makes true, and what is still missing)

The privacy notice text is not part of this PR (counsel and the owner). `content/legal/privacy.en.md` section 6 says a profile "becomes public only if you tick Show my profile publicly": the code now makes this true for every approval; it was **not** edited (a new document version would also invalidate every member's recorded consent, which is a decision for you). What it still needs to say or decide, in plain language:

- **People who are not members.** A historical master is shown without having been asked (there is nobody to ask; the life-status rule keeps out anybody whose death is not established). The notice should say that the archive holds such records, on what basis, and how a relative or anyone else asks for a record to be taken down (the take-down service of ADR 0030 is the mechanism). Whether the GDPR duty to inform a person (Art. 14) applies to the deceased is for counsel.
- **Life status.** "A person whose death has not been established is treated as living and is not shown publicly" is a promise the notice can now make.
- **Consent can be withdrawn at any time** at `/account/privacy`; the profile is hidden at once, and a verified link stays on the member's dashboard but is not shown publicly.
- **Evidence** a reviewer uses to establish a death (obituary, record) is kept with the claim, in the private bucket.

**Answer:** (filled in by the owner)

## Defaults, in one list

| Default | Where | Change by |
|---|---|---|
| Latest `publication` record decides; any document version counts | `publication.ts` (`DEFAULT D03`) | answering the first question |
| No backfill: existing public members without a record stay public | migration; none | answering the first question |
| A person without an account (in practice a historical master) is published by a verified link, subject to life status | `PERSON_MAY_BE_PUBLIC` (`DEFAULT D03`) | answering the second question |
| `person_unknown_not_public` and the one-off hiding of public unknown records | migration `*_review_consent_gates` | answering the third question |
| Verify panel: required choice, reason required for "deceased" | `review.ts` (`DEFAULT review-2026-11`) | answering the third question |
| Archival edit unknown → deceased needs evidence and a reason | `review.ts` (`DEFAULT review-2026-11`) | answering the third question |
| Revision source `archival_edit` for the committee's establishing | `stewardship.ts` (`DEFAULT review-2026-11`) | answering the third question |

## Report findings that were checked

- `privacy.md` finding 2 (the guard skipped only on `withdrawn`): confirmed, fixed.
- `privacy.md` finding 4 / `flows-core.md` M5 (the unknown status): confirmed for `markVerified` and the committee verify; fixed.
- Paths that were suspected of publishing a person (claims, invitations, organization, event and passport attachments, profile one-click publish, `setOwnVisibility`, the public views and search): they never write `visibility = 'public'` for a person except `setOwnVisibility` and the registration with the box ticked (both are the member's own choice and record the consent). The public views and search read `visibility = 'public'` only, so the new CHECK covers them. No change needed.

## Progress

- 2026-11-14: the rules module (`publication.ts`), the take-down restore, the `shown` flag in views, notifications and e-mails, the CHECK and its migration, the verify panel's plain choice, the archival edit with evidence, and the copy (request form, approval page, dashboards, claim form, onboarding, privacy page): built and pushed.
- Tests: `living-gates.int.test.ts` and `consent-gates.int.test.ts` (service and database level), `relationships.int.test.ts` and `takedown.int.test.ts` (consent), two rows each for `review.decide` and one for `archive.update` in the authorization matrix, and the e2e path of a claim about a teacher whose status is not known (`e2e/m10a-evidence.spec.ts`, with axe). The invited-teacher e2e flows (`e2e/m10b-claims.spec.ts`) now have the teacher choose "Show my profile publicly" before the link is public: that is the new rule at work.
- Existing test fixtures that made public people with the column default ("unknown") now say `living` or `deceased`; the shared archival records of the governance tests are `deceased`.
- Left for the owner: the answers above; the privacy notice text.
