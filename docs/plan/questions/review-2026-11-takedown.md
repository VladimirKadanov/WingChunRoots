# Review 2026-11 — take-down, suspension and account erasure — questions for the owner

Fix PR B of the 2026-11-13 review (`docs/adr/0030-takedown-suspension-erasure.md`). The work did not stop on these questions: it continued with the proposed defaults, each marked `DEFAULT review-2026-11` in the code. The owner changes a default by answering here; the change is then a small follow-up.

## 2026-11-13 — Take-down: what a held record looks like to everybody else

**Question:** a moderator or an administrator can take a person record off every public surface (profile, search, lineage graph, photos, schools, events, organizations, sitemap) with a reason. While it is held, what do the people around the record see, and what happens when it is put back?

**Options:**
1. **Hold, reversible, visible to the people involved** (proposed). The record stays in the database and stays visible to its owner, the other end of its relationships and staff, exactly like `involved_only`; nothing is deleted. The owner is told (notification and e-mail, reason included). Putting it back restores the visibility the record had before (or the owner's own choice made meanwhile), except when the owner withdrew publication consent in the meantime. The held state cannot be published by any path (a CHECK in the database, `markVerified`, the owner's own "show publicly" box).
2. Hide from everybody except staff (the owner no longer sees the profile). Safer in a harassment case, but the owner cannot see what was held and why.
3. Delete the record (not reversible; this is the account erasure below, not a take-down).

**Proposed default:** option 1.

**Answer:** (filled in by the owner)

## 2026-11-13 — Take-down: "Uphold the report" and the take-down checkbox

**Question:** should upholding a profile report take the profile down by itself?

**Proposed default:** no. "Uphold the report" still only closes the case; a moderator who also wants the profile held ticks "Take the profile down" on the same form (off by default), with a reason. Both the decision and the take-down are audited and noted on the case.

**Answer:** (filled in by the owner)

## 2026-11-13 — Suspension: who, what the person sees, what stays public

**Question:** who may suspend an account, and what happens to the person's profile and to the person?

**Proposed default (all of it):**
- Only an administrator with a verified second factor suspends or lifts a suspension; a moderator does not (they take profiles down, they do not lock people out).
- A suspension ends every session at once, refuses every later request on every path (cookie, bearer token, Better Auth's own endpoints, sign-in) and, when it has an end date, lifts itself at that date.
- The suspended person gets no notice and no e-mail (also none of the automatic auth e-mails). The administrator tells them by other means if at all.
- The profile of a suspended person stays as it is; a profile is taken down separately.
- Nobody suspends their own account and nobody suspends the last active administrator.
- Better Auth's admin-plugin HTTP endpoints stay disabled; the only way to suspend is the service (`accounts.suspend`).

**Answer:** (filled in by the owner)

## 2026-11-13 — Account erasure on the hosted service

**Question:** `pnpm account:delete` refuses production, and nothing else erased a person, so a hosted service could not honour an erasure request. How is an account erased hosted, and what remains of it?

**Proposed default:** an administrator with a verified second factor runs `accounts.erase` (reason required; audited) on an account that has an open deletion request or by its address. The record is anonymised in place: the profile is un-claimed and hidden or kept public as `privacy.ts` always did (only an already published, verified record of the archive stays, nameless parts removed), photos, schools, events, certificates (rows and files), passport entries, notifications, preferences, consent rows, billing rows, sign-in data and the account's own invitations and trial inquiries are removed or blanked, and pending relationship requests of the erased student are withdrawn so nobody can approve them later. Where another table still holds a restricting reference to the account (an audit-relevant record such as a relationship's confirmer, a review case's opener), the `auth_user` row stays as a tombstone: address replaced by a reserved `erased-<id>@erased.invalid`, name blank, banned, role `user`, no credentials. With no such reference the row is deleted.
- The local command `pnpm account:delete` stays the production-refusing local tool and calls the same service.
- Evidence files uploaded by the person stay (they belong to a relationship record that survives) but the original file name, the hash of the original and the link notes are cleared.
- A staff account (moderator, archivist, administrator) is not erased through this procedure: its role is removed first.

**Answer:** (filled in by the owner)

## 2026-11-13 — Account erasure: what is kept of the record, the evidence and the organizations

**Question:** an erasure has to keep what other people rely on (a relationship they confirmed) and remove what belongs to the person. Where is the line, in the cases the first question does not settle?

**Proposed defaults (each marked `DEFAULT review-2026-11` in `src/server/services/account-erasure.ts`):**
- **The name on the kept record.** The Latin display name stays on the unclaimed record (the same as `privacy.ts` always did), so a verified lineage still reads as a lineage. Every other name (original script, Jyutping, pinyin), the biography, the photos, the city, the training year, **the country and the birth date** are removed. Option: also blank or replace the display name ("Former member") on a record that no verified relationship needs; this would make the graph show a nameless node, so it was not done without your word. A record without a verified relationship is hidden, not public, and still has its name for the people at the other end of its (pending) links.
- **Evidence.** A file the person uploaded that no verified relationship rests on is deleted (the object is removed, the row is marked deleted). A file a verified relationship rests on stays (the relationship record survives) with the original file name, the hash of the original and the link notes cleared. Option: delete these files too and keep the relationship as "verified, evidence withdrawn"; this weakens the proof of the relationship, so the safer default keeps them.
- **The training passport** of the kept record (certificates with their files, ranks, examinations, skills, attendance, organization memberships) is removed (the rows have no DELETE, so they are marked removed with their text blanked; the certificate files are deleted): it is the person's own account of their training, not a record others rely on. A rank or an examination another person wrote about the student goes with it.
- **Pending relationship requests.** The erased student's own requests and claims in any state before a decision (and a declined one) are withdrawn, so nobody can approve them later; requests waiting for the erased record as the teacher are withdrawn too. Nobody is sent a notice about it (the student of an erased teacher simply sees the request as withdrawn). A request that races the erasure still cannot be approved: `refuseStudentWithoutAccount` refuses a student whose record has no account, in the teacher's approval and in the committee's decision. Verified, disputed and revoked relationships are the historical record and stay.
- **Organizations.** An erased account that administered an organization has its `organization_admin` rows revoked (the rows stay, because the table has no DELETE: who held authority stays on record, so the account row stays as a tombstone). If it was the only administrator the organization is left without one, and no other administrator is appointed by this procedure. Please say if an organization with a lone administrator must block the erasure instead.
- **Staff accounts** (moderator, archivist, administrator) are not erased through this procedure: the role is taken away first. Nobody erases their own account.
- **What is not scrubbed.** `audit_log` keeps ids (never a name or an address) and the `ip_hmac` values until their key is destroyed (`docs/data-model.md` §7); `record_revision` keeps the old names of an archive record because it is append-only; `billing_event.raw` may hold what the payment provider sent (it is test-mode only in Phase 1).
- **The tombstone.** When a record that must stay still points at the account, the `auth_user` row stays: address `erased-<id>@erased.invalid`, name blank, banned for good, role `user`, no credentials. It cannot be restored (`accounts.unsuspend` refuses it). The privacy notice must name it.

**Answer:** (filled in by the owner)

## 2026-11-13 — Self-service "Delete my account"

**Question:** should a person be able to request their own erasure in the app?

**Proposed default:** not in this PR. The existing "Request deletion" case stays the way in; an administrator carries it out. A later "Delete my account" form would ask for the password again and then open the same case. Please say if it should be built.

**Answer:** (filled in by the owner)

## 2026-11-13 — Privacy notice (out of scope here; what it must say)

The privacy notice text itself is not part of this PR. Once erasure, suspension and take-down exist, the notice must say, in plain language:

- who the controller is and how to reach them; the lawful basis per purpose;
- what is stored: account and sign-in data, the profile, evidence files and notes, review notes, the record history (`record_revision`), invitations, trial inquiries, the training passport, photos, billing records, the time of the last activity;
- that a take-down, a suspension and an erasure exist, who decides them (staff with a second factor), how a person asks, and how fast they are answered;
- what an erasure keeps and why (a tombstone account row, audit entries without personal data, the verified archive record);
- the right to complain to the Commission for Personal Data Protection (КЗЛД).

## Progress

- 2026-11-13 — checkpoint 1: take-down and suspension services, enforcement, procedures, matrix and parity rows, admin forms.
- 2026-11-13 — checkpoint 2: account erasure (anonymise in place, tombstone, `USER_REFERENCES` catalogue and its test), `accounts.erase`, `/admin/accounts` (suspend, lift, erase), authorization-matrix rows for the three forms, ADR 0030, Bulgarian guides and data model.
- 2026-11-13 — checkpoint 3: code-review fixes (a held profile keeps the owner's consent withdrawal and what an approval would publish for the restore; the suspended list filters ended bans in SQL; erasure matches verification rows by account id only).
