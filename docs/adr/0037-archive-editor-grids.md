# ADR 0037: Archive editor grids and tree

- Status: accepted (default decisions of the control panel redesign, 2026-11-17)
- Context: the archive editor of M26 (ADR 0034) listed every lineage and every link of a lineage on one page. With thousands of records it was a flat list of hundreds of links. Archivists work there for hours on a desktop.

## Decision

- Five read-only procedures in `src/server/services/archive-grids.ts` (`archiveEditor.overview`, `.people`, `.links`, `.tree`, `.person`), staff with the second factor and the archive roles only, never cached. Mutations stay with the M26 procedures.
- Every view is server markup: filters, sorting, paging and the open branches of the tree live in the URL (plain links and GET forms). No new client JavaScript; the bundle stays as it was.
- The tree reads only the root and the branches listed in `?open=` (at most 40), and at most 50 students per branch; the links grid has the rest. A lineage of any size answers in a few small queries.
- A link is "active" while verified or in arbitration. "Sourced" means a source note, or a link the teacher approved themselves. "Needs work" means not sourced or no start year.
- Generations are counted from the lineage's root along active links (a recursive query over `teaching_relationship`, not `lineage_membership`, which follows public edges only). A person not connected to the root has no generation.
- "Possible duplicates": another non-deleted record has the same primary name (case and diacritics folded with `unaccent`). Cheap and explainable; a fuzzier match can come later.
- The search of the people and links grids matches a stored name containing the text, a search key (src/server/search/keys.ts) starting with any form of the query or with a later word of it, or the record's address, over every record, public or not.
- No bulk actions: ending a link needs its own reason, and no service changes the years or the source of a link yet. Correcting them means ending the link and adding it again.
