# Visual site editor: plan (2026-11-24)

Status: **phases 0–6 built** (2026-11-24); phase 6's browser runs are pending their first CI runs. Decided: flow first with free layers later (1), one responsive document
per page with Phone/Tablet/Desktop breakpoints (2), classic blocks kept until converted or redesigned (3), a
per-tenant rollout flag with the old editors as "Classic editor" (8); fonts and colours (5, 6) run on the defaults
until decided (see section 6). This replaces
the form-based block editor with direct manipulation, Canva-style, for Showcase sites and the store's own site.
AI-generated pages must be editable with it.

**Built so far**
- Model: `@jeffi/site-blocks` `code.ts` (tree types, `NODE_ID`); store-core `lib/site/code/ids.ts` (the compile's ids
  mode), `print.ts`, and in `compile.ts` `sectionTree`, `compileCodeProps` (the one save path), `upgradeCodeProps` /
  `upgradeCodeSections` (load), `canvasCodeSections` (the canvas draws ids on v1 sections too).
- Operations and history: `@jeffi/site-blocks/design` (a subpath, so rendering never loads it). Panel classes:
  `lib/site/code/classes.ts`.
- Flag: `site_settings.site_editor_enabled = 'true'` (`siteEditorEnabled`). It turns on the canvas bridge and the v2
  load (`GET /api/admin/site-builder/drafts/[id]?tree=1`).
- Spike: `components/visitor/site/editor/SiteEditorBridge.tsx`, loaded lazily by `SiteEditorGate` with a preview token.
  Messages are `site-editor:*` (see the file). Components (`<Link>`, parts) carry no `data-e` yet.
- Tests: `tests/lib/site-code-roundtrip.test.ts` (225 template sections), `site-code-classes`, `site-editor-imports`,
  `packages/site-blocks/tests/design.test.ts`.
- Contract for phase 2: the visual editor saves a section's tree with `source` empty; source-level editors
  (`literals.ts`, the AI) write `source`, which wins and rebuilds the tree.

**Phase 2 (editor MVP), in slices**
1. Shell, select, inline text, undo/redo, autosave. `components/site-editor/`: `SiteEditor.tsx` (toolbar, canvas,
   sections, inspector), `state.ts` (a design history per section plus one undo stack across sections and block-list
   changes; `docToSave` sends trees with an empty source; `adoptSaved` takes the server's tree when it settled one
   differently), `host.ts` (load, save, preview URL, upload, publish), `nodes.ts`, `Inspector.tsx`. Admin host:
   `components/admin/site-builder/VisualEditor.tsx`, opened from a "Visual editor" button in the forms editor (flag on;
   desktop web layout, saved to phone too while that is the same document), loading through
   `GET drafts/[id]/editor?key=` and saving through `PUT drafts/[id]`. The canvas reloads, keeping its scroll, only
   after a save that holds a change it couldn't show itself. `data-e` now also marks Link, Image, Icon and parts drawn
   as one plain element (`RenderCtx.edit`, `data-e-cmp`).
2. Style panel and breakpoints. Phone (390, base), Tablet (768, `md:`) and Desktop (1280, `lg:`) canvas widths; the
   breakpoint shown is the one styled. `StylePanel.tsx`: font (the theme's pair), size, weight, align, text and
   background colour (theme scales from `paletteFrom` plus any hex), padding, margins, gap, width, max width, min
   height, rounding; each shows where its value comes from and clears this breakpoint's. Changes go through
   `setPanelValue` / `classOps`, so wider breakpoints keep their look; the canvas reloads after the save for the CSS.
3. Layers and reorder. `Layers.tsx`: the page's sections, each code section's elements as a tree (words beside the
   name, a lock on needed parts, a mark on what store data draws). Rows drag among their siblings with dnd-kit
   (pointer or keyboard): elements as a design `move`, sections as a block-list step. Nodes filling a slot (a
   condition's branch, a render function's body) stay put; their contents move. Selecting a row selects on the canvas.
4. Add, duplicate, delete and pictures. Elements: duplicate and delete (Delete key too), add a heading, paragraph,
   button, picture, box or divider after the selection (`nodes.ts` `newNode`, all compiler-checked in tests).
   Sections: add a starter code section, duplicate, delete (at least one stays). Parts the page needs (`locked`,
   or a classic block the registry locks) can't be duplicated or removed. Pictures swap through the host's own picker
   (`renderImagePicker`; admin: the media library field), with their description; links get a "goes to" field.
5. Showcase studio host. `controller-service/.../onboard/_studio/VisualStudio.tsx`, opened by "Edit on the page" in
   the build step of a Showcase (flag on, page built, no build running). It edits the request's own session (`?site=`
   from the page, else the session's `site_id`) through `/api/ecom/onboard/studio/design` (GET trees; PUT compiles
   every tree, keeps the page to code sections with its required parts, saves the session page). The canvas is the
   studio preview with `editor=1` (`ShowcasePreview` `editing`: `data-block-id`, canvas ids, the bridge). Pictures
   upload as the Details step's do. Publishing stays the studio's own step, whose compile is v2-aware.

**Phase 3 (free layers), in slices**
1. Model and classes. `lib/site/code/free.ts`: a free layer is `absolute` in its frame with left, top, width (and
   maybe height) in % at a breakpoint, plus a z step (`lg:absolute lg:left-[12%] lg:top-[30%] lg:w-[40%] lg:z-10`).
   `placeFree` keeps the next wider breakpoint as it was (`static` and its width pinned) unless placed too;
   `unplaceFree` puts it back in the flow; `frameFor` makes the frame `relative` and keeps its height
   (`lg:min-h-[640px]`) once the layer leaves the flow; `restack` orders layers. The node keeps its place in the tree,
   so reading order and SEO don't change. Tested down to the compiled CSS.
2. Handles and guides. In-house, on pointer events, in the lazy canvas bridge (`editor/handles.ts`, behind a small
   `LayerHandles` interface a library could replace): a selected free layer gets a move area and eight resize knobs;
   edges snap (`lib/site/code/snap.ts`) to the frame's edges, centre and fractions, to the other boxes in the frame,
   else to whole percents, with guides drawn while they hold; arrow keys nudge 1% (5% with shift). The drag shows
   through inline styles; the editor writes `placeFree` classes (`components/site-editor/free-ops.ts`) and the reload
   after the save draws them. "Free placement" toggles in the layers row and the inspector: the canvas measures the
   element (`measure`), it is placed where it sits, on top of the section's layers, and its frame made `relative` with
   its height kept. `FreePanel.tsx`: left, top, width, height in %, front/forward/backward/back, back in the flow.
3. Phone fallback and critique. Placed on a wider screen only, a layer sits in the flow at its place in the page
   below it (mobile-first classes); the layers row shows it faintly and the inspector says so, with "Place on Phone
   too" (`free-ops.ts` `placedWider`). `lib/site/critique.ts` `offScreenOnPhones` reports (`off_screen`, per element)
   layers placed on phones whose box runs past the section's edges; the owner moves them on Phone (no auto-fix).

**Phase 4 (AI in the editor), in slices**
1. Change with AI on a selection. `lib/site/studio/selection.ts`: the section printed with its `data-e` ids, the
   selected ids named, rewritten through `tweakSection`, read back as a tree; `changedIds` tells what it touched. The
   tweak prompt adds `EDITOR_RULES` for a section the editor opened (keep `data-e`, prefer theme colours, free layers
   only inside a `relative` section from a breakpoint up). Admin: `POST /api/admin/site-builder/ai/selection`, billed
   to the store's AI wallet. Showcase: `POST /studio/design/ai`, one AI correction (3 free a day, then ₹20 at the price
   shown), working on the saved section and saving inside the run, so an unsaved change isn't charged. The editor
   saves first, applies the reply as one undoable `replace`, and the changed nodes light up after the reload.
2. Cheap element actions (values, not code). `lib/site/studio/element-ai.ts`: words rewritten, shortened or
   translated (ten Indian languages and English) through the studio chat; a picture for an image slot's aspect
   through `pictureFor`, stock first, generated at draft quality otherwise. Admin `POST ai/element` (store AI wallet;
   stock photos go to the gallery with their credit, so the store's credits line names them). Showcase
   `POST /studio/design/element` (the day's free AI help, platform-funded); its pictures stay out of any gallery and
   their credits travel with the page in `settings.credits` (`addCredit`), which the live page and the preview list
   while the page shows them (`pageCredits`).
3. Critique on trees. `lib/site/code/tree-critique.ts` (pure): words too pale for their background (theme scales,
   page/text tokens and hex resolved; 4.5:1, 3:1 for h1–h3), words too long for their slot, pictures without a
   description, headings out of order across the page (one h1, no skipped level), free layers off a phone's screen.
   Fixes are design operations (text colour, alt from the nearest heading, the heading's level, the layer brought
   inside), or an AI shorten. The editor's "Check page" lists them with Show and Fix; `lib/site/critique.ts` reports
   them for code sections while the editor is on (read from their trees), and its off-screen check now uses the same
   code.
4. A redesign over manual edits asks first and offers "keep my words". A page whose code sections carry editor
   trees counts as changed by hand (`keep-words.ts` `handEdited`; the studio outline says `edited`). "Design this
   page again" then confirms that it replaces those changes and asks "Keep my words" or "Start fresh": the Showcase
   studio writes the page's words into the brief (`POST /studio/design/keep-words`, `StudioBrief.keepWords`), the admin
   page redo passes `keepWords` to `startPageRedo`. The section writer's brief reuses them where they fit; section
   changes (tweaks) leave them out. The generation rules for editor sections (`EDITOR_RULES`) came with slice 1.

**Phase 5 (migration), in slices**
1. Converters. `lib/site/convert.ts` `convertBlock` rewrites `rich_text`, `image_text`, `image_banner`, `faq`,
   `contact_details` and `composed` blocks (`convertible.ts`) as v2 code sections, by rule, mirroring their renderers'
   classes; the block keeps its id, place and visibility. Store details stay live: contact rows read `<Store>`, which
   now also gives `hours` (rows), `phoneUrl` and `mapsUrl` (`lib/site/hours.ts`, shared with `ContactDetails`), and a
   row exists only where the block showed it; composed product, category, brand, review and offer lists keep their
   parts and queries. On demand only: "Convert to editable section" in the editor's section bar, for a selected
   classic block of those kinds; the editor saves, asks the host (admin `POST /api/admin/site-builder/convert`,
   Showcase `POST /studio/design/convert`, which converts the saved block), and puts the result in place as one
   undoable step (undo makes it classic again; `state.ts` `liveTree`). Tests: `tests/lib/site-convert.test.ts`
   renders each kind before and after and compares the words, links and pictures a visitor sees.
2. Classic blocks in the editor (decision 3: kept as classic blocks until converted or designed again with AI). The
   legacy homepage sections and page-core blocks are single rows in the layers, marked "Classic", with a lock where
   the page needs them (`blockLocked`). They drag among the sections, delete from the section bar or with the Delete
   key (not when locked; undoable), and a click on the canvas or the row opens their fields: the host's
   `renderBlockFields` (admin: the forms editor's `BlockInspector`, with its section options). Field changes are
   block-list steps (`editDoc` with a gesture, so typing in one block joins one undo step per visit) and the canvas
   redraws after the save. Showcase pages hold only code sections and their required parts, so it passes no fields.
3. Theme templates stay v1 (source and compiled, no tree); not regenerated. They are editable at once already: every
   load into the editor upgrades a code section to v2 (`upgradeCodeSections`, admin and Showcase), and
   `site-code-roundtrip.test.ts` checks each of the 225 template sections parses, prints and compiles back to the same
   tree. Storing trees in the templates would add weight to `themes/templates` (1.3 MB) for no gain, and would make
   a freshly installed page read as changed by hand (`keep-words.ts` `handEdited` looks for trees), so "Design this
   page again" would ask to keep words nobody wrote. A template section gets its tree the first time the editor saves
   it.
4. Retired behind the flag (decision 8). With `site_editor_enabled` on, the admin Site Builder opens a draft in the
   visual editor, with the store/business and page pickers above it; its close button is "Classic editor", which
   shows the forms (block list, `BlockInspector`, `CodeSectionPanel`'s `literals.ts` fields, templates, theme) marked
   "Classic editor", with "Visual editor" to go back. The app layout, pages the canvas can't show and new custom pages
   stay in the classic editor. On a Showcase, "Edit on the page" is the build step's main button; arranging (the
   section list and the preview's move handles) and the words form come back only with "Classic editor". The editor
   saves a waiting change when it closes or another page is picked. With the flag off, nothing changes.

**Phase 6 (harden), in slices**
1. LCP. Converted pictures use the Image part (`convert.ts` `pic`), so the first one in the page's LCP section loads
   eagerly at high priority, as the classic blocks' do; a banner's phone picture comes first (a lazy picture hidden by
   CSS never loads), and each has a `sizes` hint. `site-convert.test.ts` checks it.
2. Responsive sweep and load budgets (`tests/responsive`). The sweep adds the editor's page (`editor-pack.ts`, built
   through the editor's own operations: free layers on Desktop and Tablet and the badge on Phone, panel styles per
   breakpoint, every convertible kind converted; `SWEEP_PACKS=editor` alone). The audit flags a free layer past its
   section's side (an error below 768px, a warning wider) or foot. Each page is held to CLS 0.1 / 0.25 and LCP
   2.5 s / 4 s (`pages.ts` `VITALS`), measured as it first paints, before any scrolling: over the first line a
   warning, over the second an error in CI (a production build) or with `SWEEP_VITALS=budget`. The CI job stays
   advisory. `site-editor-pack.test.ts` keeps the fixture compiling.
3. Playwright end to end, opt-in with `SITE_EDITOR_E2E=1` (`npm run test:ui:editor`). The canvas
   (`storefront-service/ui-tests/site-editor`): a seeded draft framed as the editor frames it; click selects,
   double-click types in place and reports a `text` operation, a free layer gets handles and reports its drag in %, a
   phone placement stays on screen, and a live page has no bridge, no `data-e` and no editing mode. The editor
   (`admin-service/ui-tests/site-editor`): the draft opens in the visual editor, a typed change autosaves to the draft
   and undoes, a classic block opens its fields and converts, "Classic editor" and back. `tests/site-editor/seed.ts`
   seeds a test DB only (flag, draft, admin session, the first pages if none) and undoes it all. CI: the advisory
   `site-editor-e2e` job (storefront and admin behind the dev router).

**Left after phase 6:** the e2e specs and the sweep's new checks have not run against servers yet (agents don't build
or start them); the first runs of the advisory `responsive` and `site-editor-e2e` jobs will show whether the budgets
and selectors hold, and both get promoted to `checks` once reliable. The admin spec signs in with a seeded session
cookie; if the admin's gate wants more on localhost (MFA, a client certificate), its first test says so.

**Open for the user:** decisions 5 and 6 run on the recommended defaults (fonts: the theme's pair; colours: theme
scales plus any hex, no contrast warning yet). The Showcase flag is the flagship's `site_settings` row (one switch for
all Showcase owners), since their studio runs on the platform.

## What exists

- **Page documents.** `PageDoc` (blocks by id plus their order), one per audience × surface × page
  (`packages/site-blocks/src/doc.ts`, `layouts.ts`).
  - Store sites: drafts in `site_drafts`, published to `site_pages`, 20 versions in `site_versions`, three-way merge per
    block (`merge.ts`); tables in `admin-service/database/tables/site-builder.sql`.
  - Showcase: draft in `site_studio_sessions.pages`, published to `showcase_sites.page`
    (`controller-service/src/lib/showcase-builder/publish.ts`).
- **Four kinds of content** (`packages/store-core/src/lib/site/blocks.ts`): 32 legacy homepage sections, content and
  `composed` blocks, locked page-core blocks, and `code_section`. The AI studio, the ready-made themes
  (`lib/site/themes/templates/*.json`) and every Showcase use `code_section` only.
- **Code sections.** The AI writes TSX. Babel compiles it to a safe JSON AST (`lib/site/code/ast.ts`, `compile.ts`).
  Its Tailwind classes are compiled at save time into scoped CSS (`code/css.ts`; arbitrary values via `allow.ts`
  `safeClass`). The storefront and `showcase-service/src/app/page.tsx` interpret the AST on the server
  (`components/visitor/site/code/CodeSection.tsx`, `interpret.tsx`).
- **Editing today.** Forms beside an iframe that fully reloads on every change (`components/admin/site-builder/SiteBuilderEditor.tsx`,
  `frameKey`). Click to select and drag to reorder through `components/visitor/home/SitePreviewBridge.tsx`. Text, link
  and image edits patch the TSX at source offsets (`code/literals.ts`). "Change with AI" is `studio/generate.ts`
  `tweakSection`. The Showcase studio reuses all of it (`controller-service/src/app/(ecom)/ecom/onboard/_studio/BuildStep.tsx`).

## 1. Editing model

| | Free-form absolute (Canva) | Flow with direct manipulation (Webflow, Framer) |
|---|---|---|
| Phones | Separate coordinates per breakpoint, or scaling; text overflows when copy or fonts change | Stacks and grids reflow; a breakpoint overrides only what differs |
| SEO, accessibility | Page order isn't reading order; arbitrary heading structure | Reading order and semantic tags kept |
| Store data | Variable-length product lists don't fit fixed boxes | Lists grow naturally |

**Recommendation: flow first, with free layers.**
- Each section is a frame; its children sit in stacks, grids or columns.
- Owners click and type, drag to reorder, and resize width, height, padding and gap with handles that snap to the
  Tailwind scale. They recolour, swap images, duplicate and delete.
- Any element can become a **free layer** for Canva-style composition: `absolute`, placed in % of its section
  (`lg:left-[12%] lg:top-[30%] lg:w-[40%]`), ordered by layer. On phones it falls back into the flow at its page
  position unless placed there too. This keeps reading order, reflow and low CLS.
- Breakpoints: Phone (base classes), Tablet (`md:`), Desktop (`lg:`). Editing on Desktop writes `lg:` only. Editing on
  Phone writes base classes and pins the old value on wider breakpoints that inherited it, so nothing else changes.

## 2. Build vs adopt

| Library | License | Fit | Verdict |
|---|---|---|---|
| GrapesJS | BSD-3 | Plain JS, own HTML/CSS model | No: bypasses our safe AST, parts and server renderer |
| Puck | MIT | Native React, Next recipe; blocks plus fields | No: no free layers, resize or style panel. Fallback only for block-level editing |
| Craft.js | MIT | React node tree, renders in its own tree | No: one maintainer, outside our server renderer |
| Tiptap 3 | MIT core | Already installed (`EmailComposer`) | **Yes**: inline paragraphs, bold/italic/link |
| react-moveable | MIT | Fine | **Yes**, editor only: resize handles, snap guides |
| dnd-kit | MIT | Already installed | **Yes**: layers tree, library drag |
| Konva / Fabric | MIT | Draws to canvas bitmap | No: output isn't HTML, so no SEO |

**Recommendation: build the shell, adopt the small pieces.** The editor lives in
`packages/store-core/src/components/site-editor/`, with host adapters for admin and Showcase (save, preview URL,
uploads). It adds Tiptap, react-moveable, dnd-kit and Tailwind 3's browser build with the shared preset (editor-only,
loaded on demand, so new classes style instantly; the server compile stays the authority). Storefront and showcase
pages import none of it.

**Canvas.** The iframe keeps rendering the draft through the real renderer (real parts, real data, real media queries
at 390, 768 and 1280 px). A preview-only bridge, successor to `SitePreviewBridge.tsx`, finds elements by `data-e` node
ids, draws selection, handles and guides, edits text in place, and applies each committed change to the page. After a
pause, a soft refresh reconciles with the server render, replacing today's full reload.

## 3. Data model

- **Unchanged:** `PageDoc`, drafts, publish, versions, merge, existing tables. No new tables.
- **`code_section` v2** props: `{ label, tree, source, compiled }`. `tree` is today's `CodeNode` with a stable `id` per
  node, and is what the editor edits. `source` is printed from the tree (new `code/print.ts`) with ids as `data-e`
  attributes, so AI rewrites keep them.
- **One validator:** every save runs `compileSection(print(tree))`; a tree from the browser is never trusted (as
  `recompileCodeSections` in `lib/site/store.ts` does today). The compile gains an ids mode: `data-e` back to node ids,
  `.map` over literal lists unrolled into explicit nodes (each card editable), consts inlined. Class names built from
  expressions stay read-only.
- **Edits are typed operations** in a new `packages/site-blocks/src/design.ts`: set text, set classes per breakpoint,
  set attribute, insert, move, duplicate, remove, wrap. Each returns its inverse (undo/redo, grouped per gesture).
  Autosave stays debounced.
- **Style panel:** a new `code/classes.ts` maps a fixed set of utilities to panel properties per breakpoint (type,
  theme colours plus `[#hex]`, spacing, size, radius, border, shadow, layout, position). Unknown classes are kept.
- **Data-bound text:** product data isn't edited inline (links to the catalogue). Showcase services, reviews and FAQs
  (`code/parts/showcase.tsx`) write to `showcase_sites.content`.
- **Migration:** v1 sections upgrade to v2 on load and save as v2 on the next save; published v1 pages keep rendering.
  Theme templates are regenerated with `scripts/site-themes`. `rich_text`, `image_text`, `image_banner`, `faq`,
  `contact_details` and `composed` get rule-based converters. The 32 legacy sections and page-core blocks stay
  **classic blocks** (move and delete as units, edited with the existing `BlockInspector`). Required parts
  (`PaymentStep`, `AddToCart`…) are locked nodes, enforced by `checkPageParts`.
- **Rendering:** the server interpreter is unchanged. `data-e` and the bridge appear only with a preview token, so
  live pages ship no editor code.

## 4. AI

- Generation (`studio/generate.ts`, `redesign.ts`, the Showcase studio) still writes TSX; compiled to v2 it is editable
  at once. Prompts add: keep `data-e` on kept elements, prefer theme colours, free layers only inside a `relative`
  section with a phone fallback.
- "Change with AI" on a selection: the prompt gets the printed section plus the selected ids; the reply applies as one
  undoable change with the changed nodes highlighted.
- Cheap element actions (rewrite text, translate, image at the slot's aspect) return values, not code.
- Fix/critique: extend `lib/site/critique.ts` to trees (contrast, overlong text, alt text, heading order, free layers
  off-screen on phones); fixes apply as operations; add a headless overflow check at 390/768/1280 px.
- A redesign over manual edits asks first and offers "keep my words".

## 5. Phases (about one senior developer; two halve the calendar)

| Phase | Deliverables | Effort |
|---|---|---|
| 0. Spike | Bridge prototype: select, inline text, class edit with browser Tailwind, resize | 1–2 wk |
| 1. Model | Ids, printer, unrolling; round-trip property tests over all templates and stored sections; v2 upgrade; operations and history; preview `data-e` | 3 wk |
| 2. Editor MVP | Admin Site Builder and Showcase: select, inline text, image swap, colour/font/spacing panel, breakpoints, layers, add/duplicate/delete, reorder, undo/redo, autosave, publish | 6–7 wk |
| 3. Free layers | Absolute layers, resize handles, snap guides, phone fallback | 3 wk |
| 4. AI | Selection-aware change, text and image actions, critique on trees | 2 wk |
| 5. Migration | Converters, classic-block hosting, theme regeneration; retire the forms, `literals.ts` editing and `BuildStep` arranging behind a per-tenant flag | 3–4 wk |
| 6. Harden | Responsive CI sweep, LCP/CLS budget, Playwright end-to-end | 2 wk |

Total about 20–24 weeks. **First usable version: phases 0–2, about 10–12 weeks**, covering code sections (every
Showcase and every AI-built store): text, images, colours, fonts, spacing and size from the panel,
duplicate/delete/reorder, undo/redo, phone and desktop breakpoints. Cut from it: free layers, resize handles,
multi-select, rotation, rich text beyond bold/italic/link, classic-block conversion, per-node merge, presence.

**Risks:** round-trip fidelity of AI TSX (unroll literal lists, lock dynamic expressions, property tests); free layers
hurting phones or SEO (percent units, phone fallback, critique checks, CI sweep); canvas drifting from the server
render (soft refresh); CSS and font weight (cap classes and families); the native app home can't render trees;
bridge security (same allowlist, sanitise pasted content).

## 6. Decisions

1. Flow with free layers (**recommended**) or a pure absolute canvas. **Taken: flow with free layers** (phase 3).
2. One responsive document for desktop and phone web with breakpoints (**recommended**; reverses the 2026-11-15
   "six separate layouts" decision for web) or separate phone documents. **Taken: one responsive document**; the
   editor edits the desktop web layout and saves the phone one too while it is the same document.
3. Legacy homepage sections: keep as classic blocks, convert, or require an AI redesign; and when the old Homepage
   builder (`settings/homepage`) goes. **Taken: kept as classic blocks** (single units in the editor, their fields in
   `BlockInspector`) until converted (six content kinds, on demand) or designed again with AI. When the old Homepage
   builder goes is still open.
4. The native app home: stays on classic blocks, or out of scope. **As built: stays on classic blocks** (the app layout
   is edited in the classic editor).
5. Fonts: the theme's pair only, or a per-element choice from `FONT_CHOICES` (at most 3 families). **Open**; runs on
   the theme's pair.
6. Colours: theme colours only, or any hex with contrast warnings. **Open**; runs on theme scales plus any hex, with
   the critique's contrast check (phase 4).
7. Showcase inline edits to services and reviews: write to content (**recommended**) or freeze as literal text. **As
   built:** words drawn from content stay bound to it (locked in the tree); words typed in the section are literal.
8. Rollout: a per-tenant flag, and how long the old editor stays. **Taken: the per-tenant `site_editor_enabled` flag**
   (the flagship's row for all Showcases); with it on, the old editors are the "Classic editor" fallback. How long they
   stay is open.
