# ADR 0042: Correcting an archive link in place

- Status: accepted (default decisions of the control panel redesign, 2026-11-17)
- Context: the links grid (ADR 0037) let archivists end a link entered by mistake, but correcting its training years or its source meant ending it and adding it again. That leaves a revoked link and a new one for what is only a typo, and drops the link's confirmation and history.

## Decision

- A new procedure `archiveEditor.editLink` (`POST /api/v1/archive-editor/links/edit`), service `editArchiveLink` in `src/server/services/archive-editor.ts`: an archivist or an administrator with the second factor (the archive roles of M26), a required reason, the years and source validated exactly as `addLink` does (one shared check).
- Only links the archive keeps are edited: verified, `committee_review`, neither end a member's own record (`archiveKeepsLink`, the same rule as `endable`). A link with a member's own record, or one their teacher approved, is refused with a message that members' links change through their review flow; a link in arbitration or ended is refused too. Nothing is changed silently.
- The status, confirmation, visibility and display preference stay. No `relationship_event` is written: those rows record changes of status (and carry the idempotency keys), and an edit is none. The edit is naturally idempotent instead: the same values a second time change nothing and write nothing.
- Changed years replace the link's training periods with one period in years (or one of unknown dates when both are empty), keeping the school of the first period that had one. Unchanged years leave the periods as they were, so a source-only edit never flattens month-precision periods from a claim.
- The audit row (`relationship.edit`) carries ids, the lineage, which fields changed, the years before and after, the number of periods before, and the source's length before and after, never the source text or a name (plan §6.4). The reason is kept as staff wrote it.
- After an edit the same public tags as `addLink` and `endLink` are dropped (both people with their teachers above, the lineage, the explorer's start list); the years show on the profiles. No `lineage.recompute` is queued: the years do not change `lineage_membership`.
- The form in the links grid's panel (`src/app/admin/archive/edit-link-form.tsx`) is a Server Component posting a thin Server Action: no client JavaScript, so the route stays within its 170 kB budget. A refusal is kept for the page (`keepFormResult`) and shown in the form; success opens the link again with an outcome note.
