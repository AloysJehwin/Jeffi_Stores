# Visual site editor: plan (2026-11-24)

Status: **phases 0–1 built** (2026-11-24). Decided: flow first with free layers later (1), one responsive document
per page with Phone/Tablet/Desktop breakpoints (2), a per-tenant rollout flag (8); the rest stay open. This replaces
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

1. Flow with free layers (**recommended**) or a pure absolute canvas.
2. One responsive document for desktop and phone web with breakpoints (**recommended**; reverses the 2026-11-15
   "six separate layouts" decision for web) or separate phone documents.
3. Legacy homepage sections: keep as classic blocks, convert, or require an AI redesign; and when the old Homepage
   builder (`settings/homepage`) goes.
4. The native app home: stays on classic blocks, or out of scope.
5. Fonts: the theme's pair only, or a per-element choice from `FONT_CHOICES` (at most 3 families).
6. Colours: theme colours only, or any hex with contrast warnings.
7. Showcase inline edits to services and reviews: write to content (**recommended**) or freeze as literal text.
8. Rollout: a per-tenant flag, and how long the old editor stays.
