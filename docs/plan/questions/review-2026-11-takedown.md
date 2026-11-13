# Review 2026-11 — take-down, suspension and account erasure — questions for the owner

Fix PR B of the 2026-11-13 review (`docs/adr/0030-takedown-suspension-erasure.md`). The work did not stop on these questions: it continued with the proposed defaults, each marked `DEFAULT review-2026-11` in the code. The owner changes a default by answering here; the change is then a small follow-up.

## 2026-11-13 — Take-down: what a held record looks like to everybody else

**Question:** a moderator or an administrator can take a person record off every public surface (profile, search, lineage graph, photos, schools, events, organizations, sitemap) with a reason. While it is held, what do the people around the record see, and what happens when it is put back?

**Options:**
1. **Hold, reversible, visible to the people involved** (proposed). The record stays in the database and stays visible to its owner, the other end of its relationships and staff, exactly like `involved_only`; nothing is deleted. The owner is told (notification and e-mail, reason included). Putting it back restores the visibility the record had before (or the owner's own choice made meanwhile), except when the owner withdrew publication consent in the meantime. The held state cannot be published by any path (a CHECK in the database, `markVerified`, the owner's own "show publicly" box).
2. Hide from everybody except staff (the owner no longer sees the profile). Safer in a harassment case, but the owner cannot see what was held and why.
3. Delete the record (not reversible; this is the account erasure below, not a take-down).

**Proposed default:** option 1.

## 2026-11-13 — Take-down: "Uphold the report" and the take-down checkbox

**Question:** should upholding a profile report take the profile down by itself?

**Proposed default:** no. "Uphold the report" still only closes the case; a moderator who also wants the profile held ticks "Take the profile down" on the same form (off by default), with a reason. Both the decision and the take-down are audited and noted on the case.

## 2026-11-13 — Suspension: who, what the person sees, what stays public

**Question:** who may suspend an account, and what happens to the person's profile and to the person?

**Proposed default (all of it):**
- Only an administrator with a verified second factor suspends or lifts a suspension; a moderator does not (they take profiles down, they do not lock people out).
- A suspension ends every session at once, refuses every later request on every path (cookie, bearer token, Better Auth's own endpoints, sign-in) and, when it has an end date, lifts itself at that date.
- The suspended person gets no notice and no e-mail (also none of the automatic auth e-mails). The administrator tells them by other means if at all.
- The profile of a suspended person stays as it is; a profile is taken down separately.
- Nobody suspends their own account and nobody suspends the last active administrator.
- Better Auth's admin-plugin HTTP endpoints stay disabled; the only way to suspend is the service (`accounts.suspend`).

## 2026-11-13 — Account erasure on the hosted service

**Question:** `pnpm account:delete` refuses production, and nothing else erased a person, so a hosted service could not honour an erasure request. How is an account erased hosted, and what remains of it?

**Proposed default:** an administrator with a verified second factor runs `accounts.erase` (reason required; audited) on an account that has an open deletion request or by its address. The record is anonymised in place: the profile is un-claimed and hidden or kept public as `privacy.ts` always did (only an already published, verified record of the archive stays, nameless parts removed), photos, schools, events, certificates (rows and files), passport entries, notifications, preferences, consent rows, billing rows, sign-in data and the account's own invitations and trial inquiries are removed or blanked, and pending relationship requests of the erased student are withdrawn so nobody can approve them later. Where another table still holds a restricting reference to the account (an audit-relevant record such as a relationship's confirmer, a review case's opener), the `auth_user` row stays as a tombstone: address replaced by a reserved `erased-<id>@erased.invalid`, name blank, banned, role `user`, no credentials. With no such reference the row is deleted.
- The local command `pnpm account:delete` stays the production-refusing local tool and calls the same service.
- Evidence files uploaded by the person stay (they belong to a relationship record that survives) but the original file name, the hash of the original and the link notes are cleared.
- A staff account (moderator, archivist, administrator) is not erased through this procedure: its role is removed first.

## 2026-11-13 — Self-service "Delete my account"

**Question:** should a person be able to request their own erasure in the app?

**Proposed default:** not in this PR. The existing "Request deletion" case stays the way in; an administrator carries it out. A later "Delete my account" form would ask for the password again and then open the same case. Please say if it should be built.

## 2026-11-13 — Privacy notice (out of scope here; what it must say)

The privacy notice text itself is not part of this PR. Once erasure, suspension and take-down exist, the notice must say, in plain language:

- who the controller is and how to reach them; the lawful basis per purpose;
- what is stored: account and sign-in data, the profile, evidence files and notes, review notes, the record history (`record_revision`), invitations, trial inquiries, the training passport, photos, billing records, the time of the last activity;
- that a take-down, a suspension and an erasure exist, who decides them (staff with a second factor), how a person asks, and how fast they are answered;
- what an erasure keeps and why (a tombstone account row, audit entries without personal data, the verified archive record);
- the right to complain to the Commission for Personal Data Protection (КЗЛД).

## Progress

- 2026-11-13 — checkpoint 1: take-down and suspension services, enforcement, procedures, matrix and parity rows, admin forms.
