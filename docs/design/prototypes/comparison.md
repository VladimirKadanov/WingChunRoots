# WingChunRoots: design direction comparison

Four interactive prototypes, reviewed on 2026-10-16 by reading their code and capturing about 150 screenshots at 390×844 (iPhone 13 emulation), 375×667 (iPhone SE) and 1440×900, in dark and light themes. The prototypes are Ink Lineage, Living Archive, Constellation and Transit Map.

## Recommendation

**Build "Ink Register": the Ink Lineage visual language on top of the Living Archive explorer model.**

- **From Ink Lineage (the visual system M00b turns into tokens):**
  - ink, paper and seal tokens;
  - the editorial display serif for names;
  - status drawn into the stroke and stamped as a seal;
  - the founder line that inks in after a tap.
- **From Living Archive (the explorer mechanics for M05 and M06):**
  - fixed-size card nodes that fit ELK;
  - a text label on every link of the focused path;
  - a hatched "Gen ?" lane;
  - edge chips for links that leave the screen;
  - a side panel that leads with the evidence.
- **Small additions:**
  - Transit Map: the compact phone sheet and the founder end cap;
  - Constellation: the always-visible legend and the "Back to …" trail chip.

Why this combination:

1. **Ink and Archive tie on points (58/70 each), and their strengths complement each other.** Ink wins on the two criteria that are hardest to add later: an identity people remember (9/10) and fit with a Chinese martial-arts heritage (10/10). Archive wins on explorer clarity, scale and fit with the planned stack. Its strengths are interaction patterns, and patterns carry over to any visual style. A visual identity does not carry over the same way.
2. **Ink's palette is already the plan's palette.** The plan's token table (§5.2) describes "a dark, restrained theme in the spirit of ink, paper and seal" (`#121214`, `#EAEAEA`, `#D32F2F`). Ink is the only proposal that builds on those exact values, so M00b's contrast work is mostly done.
3. **Both use a top-down layout with one row per generation.** That is what ELK `layered` (DOWN), as configured in plan §4.5, produces. Neither needs a second layout engine.
4. **Transit Map has the clearest topology but the weakest brand fit.** A metro map is a borrowed civic metaphor, and "Ride 7 stops to Gen 1" makes a lineage sound trivial. Colouring each lineage as a line also stops working beyond about 8 halls.
5. **Constellation is the weakest choice for this product.** Several of its core traits conflict with the plan:
   - a sky that twinkles and moves with the pointer (parallax) without being asked (§5.4 and §5.8(д));
   - 200/300 font weights on dark backgrounds (§5.2);
   - a recentred layout that moves every star on each tap, which breaks the stable layout required by §4.5 and §5.8(д);
   - a radial "sky" that ELK `layered` cannot produce.

## Scorecard

Each criterion is scored out of 10:

- **Craft:** how distinctive the design is and how well it is made.
- **Explorer UX:** how clearly the lineage explorer shows people with several teachers, teachers from another lineage and the verification states.
- **Phone/webview:** how well it works on a phone and inside an in-app webview.
- **A11y:** accessibility.
- **Scale:** how well it handles focused views of 500–800 people drawn from thousands.
- **Stack fit:** how easily it can be built with Next.js 16, React Flow, ELK `layered`, shadcn/Base UI and MapLibre.
- **Brand fit:** how well it suits a martial-arts heritage archive.

| Direction | Craft | Explorer UX | Phone/webview | A11y | Scale | Stack fit | Brand fit | **Total /70** |
|---|---|---|---|---|---|---|---|---|
| Ink Lineage | 9 | 8 | 8 | 7 | 8 | 8 | 10 | **58** |
| Living Archive | 8 | 9 | 7 | 8 | 9 | 9 | 8 | **58** |
| Transit Map | 8 | 9 | 8 | 7 | 6 | 7 | 4 | **49** |
| Constellation | 7 | 5 | 6 | 5 | 3 | 4 | 5 | **35** |

## How this was checked

Every prototype went through the same scenarios:

- home, the lineage explorer with nothing selected, and the explorer focused on test people;
- the list view, the school finder and the Sifu desk ("Me");
- both themes, phone and desktop.

The test people cover the hard cases in the shared demo data:

- **Yiannis Karras:** a second teacher, Martin Ashby, from another lineage (Silver Willow), verified.
- **Raymond Szeto:** his primary link is in arbitration, his second teacher is verified and his generation is disputed (5 or 6).
- **Lam Kin-wah:** a second teacher whose link is unconfirmed and whose generation is unknown (Tam Kau).
- **Mira Kostova:** two teachers, plus a private pending claim that only the people involved should see.
- **Dimitar Kolev:** 8 generations, used for the signature animations.

Automated checks:

- **axe-core 4.14.0:** WCAG 2.0–2.2 A/AA rules, 16 runs per prototype (4 screens × 2 themes × 2 sizes).
- **Effective contrast of dimmed graph labels:** measured with the opacity of every parent element applied.
- **Smallest on-screen label size:** in pixels, with any SVG scaling applied.
- **Motion that starts on its own:** screenshots compared over 9 s with no input, plus a count of `requestAnimationFrame` calls while idle.
- **Reduced motion:** the screen 120 ms after the trigger compared with the settled screen.
- **Font coverage:** Cyrillic coverage of every proposed font, tested by requesting a Cyrillic subset (`text=Костова`) from Google Fonts.
- **Font bytes:** total web-font size downloaded on the explorer screen.
- **Long tasks:** measured during a focus change with the CPU slowed 4×.
- **Layout:** horizontal overflow and console errors.

Limits: Chromium emulation only, with no WebKit and no real devices. All four layouts are placed by hand for 43 people, so their performance says little about a React Flow implementation.

## Cross-cutting findings (all four need these fixed in implementation)

- **Dimming uses opacity, which plan §4.7 forbids.** With Raymond Szeto focused, the dimmed labels measured:

  | Prototype | Dimmed labels | Opacity | Contrast |
  |---|---|---|---|
  | Ink | 71 of 97 | 0.2 | about 1.4:1 |
  | Archive | 68 of 105 | 0.12–0.17 | 1.0–1.3:1 |
  | Transit | 53 of 82 | dimmed | not measured |
  | Constellation | 28 of 39 | 0.34 | 2.8:1 dark, 2.1:1 light |

  All of these fall below the plan's 3:1 floor. The hybrid must dim with solid tones instead: `--unconfirmed` for strokes, `--fg-muted` for text, `--border-strong` for frames.
- **Generation-row labels must follow D22 (plan §4.4).** All four align every hall on one "Gen N" rail. "Generation N from {root}" is allowed only when the view's root is that hall's founder and every link on the path is verified. Otherwise the label reads "N generations below {name} in this view".
- **The status legend should stay visible in the explorer frame (plan §4.6).** Only Constellation keeps it on screen at all times. Ink, Archive and Transit show the key only while nothing is selected.
- **The zoom buttons cover labels on phones.** This happens in Ink, Archive and Transit, for example over "Lam Kin-wah" in Transit and over cards in Archive.
- **Chinese fonts:**
  - Ink and Constellation load `text=` subsets of Noto Serif TC.
  - Archive loads the full Noto Serif TC stylesheet, which downloaded 896 KB in 20 files on the explorer screen.
  - Production uses system CJK fonts (plan §5.3), so the hybrid must look right with Songti/PingFang/JhengHei.

## Ink Lineage: 58/70

**Verdict.** Ink Lineage is the most distinctive and the most "WingChunRoots" of the four. It reads as a hand-kept register:

- Gloock display names with their Chinese names;
- a cinnabar seal as the brand;
- links drawn as tapering ink strokes, each stamped with a state seal (a dotted "?", an hourglass on a broken stroke, a check seal, a scales seal for arbitration);
- a founder trace that inks in one generation at a time, in step with the "Line to the founder" list in the panel.

The explorer handles the hard cases well:

- Yiannis's teacher from another lineage is a hollow curve labelled "CROSS-LINEAGE", and the panel adds a "Cross-lineage · Silver Willow Hall" tag.
- Raymond shows "6th generation (disputed)" with a scales seal on a dashed double stroke.
- Tam Kau sits under "GEN ?".

It was also the fastest to refocus: one long task of about 80 ms at 4× CPU slowdown, against 4–11 long tasks for the others.

Weaknesses:

- **Phone layout.** On a phone the half-open sheet covers about 55% of the graph, and people off the traced line shrink to initials ("RS", "SR"), which are hard to scan.
- **Red means too many things.** It is the brand, the primary button, the verified seal and the selection highlight. Plan §5.2 reserves red for the primary button, and the panel pairs a red check with a green "Verified".
- **No Cyrillic in the main fonts.** Neither Gloock nor Schibsted Grotesk has basic Cyrillic: Google Fonts serves only `cyrillic-ext` for Gloock, and a `text=Костова` subset comes back empty. Cyrillic names would fall back to another font. The stack already lists Noto Serif Display, which has Cyrillic, as a fallback, so self-hosting it fixes this.
- **Small labels and dimming.** The generation captions are 8px, and dimmed labels at opacity 0.2 are nearly invisible.

**Borrow (as the base):**

- **Tokens:** the ink, paper and seal tokens taken directly from plan §5.2, with the paper light theme and the night-paper dark theme.
- **Type:** Gloock for names and numbers, Schibsted Grotesk for the UI, and size-adjusted fallback faces to limit layout shift.
- **Status seals:** state written into each stroke and stamped as a seal, with the seal sliding along the curve so it never covers a label.
- **The founder trace:** the ink-in animation and the panel's "Line to the founder" list that moves with it (instant under reduced motion).
- **Labels on the traced line:** full names stay on the traced line when zoomed out.
- **Phone shell:** history layers so Android Back closes the top sheet or modal, a Recenter pill, and a sheet you can drag by its body.
- **Private schools:** a hatched city area with a "city only" badge.

## Living Archive: 58/70

**Verdict.** Living Archive has the most honest and complete explorer. Every focused link carries a text pill ("VERIFIED", "IN ARBITRATION"), and disputed generations read "GEN V/VI · DISPUTED". People of unknown generation sit in a hatched "Gen ? · teacher not recorded" lane. Links that leave the screen end in edge chips you can tap, for example "Martin Ashby · cross-lineage teacher". The panel cites the evidence ("Verified by teacher, 8 May 2025 LNK-0016").

Its card nodes (name, Chinese name, title, years and city in a card about 200×64) match the fixed ELK node sizes in plan §4.5 almost exactly. React Flow's MiniMap, EdgeLabelRenderer and group nodes cover the minimap, the pills and the lane. That makes it the cheapest to build and the best at scale.

Weaknesses:

- **Looks generic.** The cards on the wall resemble a well-made org chart, and the dark slate-and-teal palette is calm but not memorable.
- **Roman numerals.** Generations are written in Roman numerals ("GEN VII"), which are harder to read and are read out letter by letter.
- **No back or keyboard handling.** The code never calls `pushState` or handles `popstate`, so Android Back leaves the page instead of closing a sheet. It also does not track the visual viewport, so forms can sit under the on-screen keyboard.
- **axe found three issues:**
  - a critical `aria-activedescendant` that points to a removed option after a search pick;
  - a 3.71:1 caption on the Me screen;
  - card `aria-label`s that do not start with the visible name.
- **Tiny meta text on phones.** At the wall's phone zoom the card meta lines shrink to about 4–5px; 50 of 68 labels are under 11px.
- **Overlap on a small phone.** At 375px the "Open record" button overlaps the "Gen V/VI DISPUTED" chip.
- **Animation on scroll.** The home exhibit draws itself when scrolled into view, which is a small animation that starts on its own.

**Borrow (as the explorer model):**

- **Cards and labels:** fixed-size card nodes (name, Chinese name, title · years · city), with a text pill on every link of the focused path.
- **Disputed and unknown generations:** a "GEN 5/6 · DISPUTED" tag, and a hatched "Gen ?" lane labelled "teacher not recorded".
- **Off-screen links:** edge chips that pan to the other end of the link.
- **Evidence-first panel:** who verified the link and when, the link id, and teachers listed before students.
- **Wall controls:** "Show full path" and "Clear" actions, a minimap and the year range on each row ("began 1983–2002").
- **Phone sheet:** content below the peek is `inert`, focus is restored on purpose, and a polite live region announces changes.
- **Map:** label placement treats pins, controls and the scale bar as obstacles, and phones get a hall filter as a radio sheet with counts.
- **Plan limit:** the "4 of 5" approval slots design, without pressure.

## Transit Map: 49/70

**Verdict.** Transit Map has the most legible topology:

- every lineage is a coloured line;
- a person with several teachers is an interchange ring;
- a teacher from another lineage arrives by a double-track "transfer" corridor;
- link states are drawn into the track and backed by text chips;
- the "Route to the founder" timeline in the panel is excellent.

It is also the most webview-ready shell:

- a 96px peek sheet leaves the most room for the map;
- map tools fade when the sheet leaves little room;
- every step pushes a history entry;
- the keyboard is tracked through the visual viewport;
- `<html lang>` is set, and axe found no violations on 12 of its 16 runs.

But the metaphor works against the brand. It is a civic, transport-signage look with loud condensed capitals, and "Ride 7 stops to Gen 1" makes a teaching lineage sound like a commute.

It also scales poorly:

- **Colour.** Colour-per-lineage runs out after about 8 halls.
- **Readability.** Station labels drop to about 5–9px whenever the camera fits a route; on a phone, 31 of 34 labels were under 11px.
- **Truncation.** At 375px the peek cuts the name to "RAYMOND SZ…".

The orthogonal tracks do match ELK `ORTHOGONAL` routing. The 45° corners would be a post-processing step, and the shared trunks need `elk.layered.mergeEdges` or custom bundling.

**Borrow:**

- **Phone sheet:** the compact 96px peek and tools that fade when space is tight.
- **Founder shortcut:** the floating end cap ("↑ Gen 1 · Hon Yat-fung"), which jumps to the founder and then back to you.
- **Route list:** the "Route to the founder" timeline with a year per stop.
- **Several teachers:** an interchange-style ring marker as the "2 teachers" cue on a node.
- **Undo toast:** lasts 10 s and pauses while touched or focused.
- **Fonts:** check every font for Cyrillic coverage the way Sofia Sans was chosen.

## Constellation: 35/70

**Verdict.** Constellation has the most beautiful hero, with hall constellations, a frosted panel over a starfield and a pretty dawn light theme. It also has three good ideas:

- a legend that stays on screen;
- a "Back to <name>" trail chip;
- an 11px minimum for every label it shows (0 of 73 labels under 11px on the phone explorer).

Its central idea fights the product:

- **Unstable layout.** Re-centring moves every star on each tap, so users lose their sense of where people are (plan §4.5 asks for a stable order between visits).
- **Halls mixed on one row.** The "same generation" horizon puts people from different halls side by side, which suggests their generation numbers are comparable when they are not.
- **Visual noise.** The unrelated sky stays drawn behind the focus as a web of lines, and on phones the trail chip and the "CROSS-LINEAGE" label collide with labels and controls.
- **Animation that starts on its own.** The starfield runs a `requestAnimationFrame` loop all the time (120 calls per second while idle) and moves with the pointer. Plan §5.4 and §5.8(д) forbid both, and the twinkling, without a pause control, risks failing WCAG 2.2.2.
- **Thin type and heavy blur.** Jost 200/300 and Martian Mono 300 appear 17 times on dark backgrounds (plan §5.2 sets 400 as the minimum). Glass panels with `backdrop-filter` blur cost a lot in Android WebView.
- **axe found two icon buttons without names** (Sky and List) on phones.

Feasibility is the main problem. The focused part could be laid out with ELK, but the signature (orbits, the sky and the polar camera swing) needs a second radial or force layout and its own camera system.

**Borrow:**

- **Legend:** an always-visible legend bar in the explorer frame (required by plan §4.6).
- **Back trail:** a "Back to <name>" chip that retraces your focus history.
- **Label size:** a minimum of 11px for every label shown, using counter-scaled text.
- **Panel:** an "Also appears in: Silver Willow Hall · Gen 6" section for people who belong to two lineages.
- **Small touches:** an archive error state with "Try again", and fuzzy "closest names" in search.

## Feasibility with the planned stack (summary)

| | Layout engine | Nodes in React Flow | Edges | Special work |
|---|---|---|---|---|
| Ink | ELK layered DOWN. Ink's curves come from `SPLINES` or from rounding ELK's orthogonal bend points. The hall bands are bounding boxes computed after layout. | DOM nodes in the three level-of-detail sizes (card, name, initials) | A custom edge: a tapered path, a seal placed with `getPointAtLength`, and the ink-in as a `stroke-dashoffset` animation | Brush outline and seal collision |
| Archive | ELK layered DOWN, as is | 200×64 cards (matches plan §4.5) | `EdgeLabelRenderer` pills | Edge chips, the Gen ? lane as a group node, the minimap (built in) |
| Transit | ELK layered with `ORTHOGONAL` routing | Station glyphs with labels | Thick coloured tracks, 45° corners added afterwards, trunks via `mergeEdges` | Colour palette per lineage, the train animation |
| Constellation | ELK only for the focus part. The sky needs a radial or force layout (a second engine) | Stars | Patterned lines | Starfield canvas, polar camera, blur cost |

## The hybrid: what M00b and M05/M06 should take

1. **Tokens.** Use Ink's ink, paper and seal palette, which is the plan §5.2 palette.
   - **Red:** keep cinnabar for the brand mark, the primary button and the verified seal. Move the selection highlight off red, to the gold focus ring (`--focus`) or ink weight.
   - **Decision for the owner:** a red verified seal departs from plan §5.2, where `--verified` is green. The owner chooses, and the choice is recorded in ADR 0006.
   - **Dimming:** use solid tones only.
2. **Type.**
   - Gloock for Latin display and names, with self-hosted Noto Serif Display as the Cyrillic fallback, size-matched.
   - Schibsted Grotesk for the UI, which is English only.
   - System CJK fonts for Chinese.
   - A minimum label size of 11px at every level of detail (from Constellation).
   - Arabic numerals for generations (not Roman).
3. **Explorer.**
   - Archive's card nodes, styled the Ink way: Gloock name, Chinese name, title · years · city.
   - Ink's tapering strokes with state seals, plus Archive's text pill on every link of the focused path.
   - Archive's Gen ? lane and edge chips, and Ink's founder trace.
   - Transit's founder end cap and Constellation's back trail.
   - An always-visible legend.
4. **Phone.**
   - Transit's 96px peek, with Ink's three snap points and history layers.
   - Zoom controls that move clear of the focused label.
   - Names never truncated without a way to see the whole name.
5. **Motion.**
   - The ink-in runs only on tap, with a total of about 1 s or less, and never blocks input.
   - Nothing starts on its own (drop Archive's draw-on-scroll and Ink's endless marching-ants outline on a selected private area).
   - Reduced motion is instant; all four prototypes already do this correctly.

## Key screenshots

All files are in `/tmp/claude-0/-home-claude-wingchunroots/ab3471ec-9dc6-5fd1-a45d-d50c057f02ee/scratchpad/review/`:

- **Home:** `<ink|archive|const|transit>-desktop-{dark,light}.png` and `*-phone-pair.png`.
- **Explorer focus, desktop:** `{ink,arc,con,tr}-d-{lin,yiannis,raymond,lam}.png`, plus `arc-d-mira.png`.
- **Explorer focus, phone:** `{ink,arc,con,tr}-p-quad.png`.
- **Light theme focus:** `L-grid.png`.
- **Small phone:** `se-grid.png`.
- **List views:** `li-grid.png`.
- **Schools:** `sch-d.png` and `sch-p.png`.
- **Me:** `me-d.png` and `me-p.png`.
- **Signature animations:** `an-g1.png` (Ink ink-in and Constellation re-centre), `an-g2.png` (Transit ride) and `an-g3.png` (Archive trace).
- **Raw axe results:** `axe-{ink,arc,con,tr}.json`.
