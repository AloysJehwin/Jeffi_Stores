# Canvas editor for the site builder: open-source research

Status: research, for decision
Date: 2026-11-27
Builds on: [SITE_EDITOR_PLAN.md](SITE_EDITOR_PLAN.md) (visual editor, phases 0-6 built; phase 3 free layers designed)

## Summary

Do not adopt a page-builder framework. We already have the hard parts: a JSON tree model for code sections, a server renderer, an iframe canvas with a bridge, history, breakpoints and AI edits. Every candidate either wants to own the document model (GrapesJS, Puck, Craft.js, Easyblocks, Webstudio) or draws to a bitmap or its own canvas (tldraw, Polotno, Konva). Both break SEO, our safe AST, or live store data. Recommendation: **keep our editor, finish "free layers" (SITE_EDITOR_PLAN phase 3) as the Canva-style layer, and adopt only small MIT parts: a maintained move/resize/snap library for handles (Moveable is stale, so write our own thin handles or fork it), Tiptap for inline rich text, dnd-kit for layers.** Keep flow layout for the page and allow free-form "slide" sections (absolute inside one frame). Do not go fully absolute. Re-check Puck only as a fallback for block-level editing.

Facts below were checked on 2026-11-26/27 against GitHub and npm. Items marked (unverified) came from third-party pages.

## What we have today (read from the repo)

- `PageDoc` = blocks by id plus `order`, slots in `children`, optional `tablet` overrides (`packages/site-blocks/src/doc.ts`).
- Code sections compile to a JSON AST with an allowlist, scoped CSS and `data-e` node ids. Nothing runs user code (`lib/site/code/compile.ts`).
- Editor: `components/site-editor/` (about 2,200 lines: state, layers, style panel, free-layer ops, inspector, AI box), hosted by `admin/site-builder/VisualEditor.tsx`. The canvas is the real store in an iframe at 390/768/1280 px, with a `site-editor:*` bridge. Flag: `site_editor_enabled`.
- Old forms editor (`SiteBuilderEditor.tsx`, 1,099 lines) stays as the "Classic editor".

## Comparison

| Candidate | Licence (checked) | Last activity | React / Next RSC fit | Model vs PageDoc | Free canvas | Verdict |
|---|---|---|---|---|---|---|
| GrapesJS 0.23.9 | BSD-3-Clause (npm); repo shows NOASSERTION | release 2026-11-03 | Vanilla JS (Backbone); `@grapesjs/react` 2.0.0 MIT wrapper | Own HTML/CSS components | Yes (absolute mode), flow default | No |
| GrapesJS Studio SDK | Commercial, licence key; free tier 1,000 sessions/month; white-label is Enterprise | active | React SDK | Same as GrapesJS | Yes | No (cost, lock-in) |
| Puck 0.24.2 (`@puckeditor/core`) | MIT | release 2026-11-23 | Native React, Next recipe, peer React 18/19 | Component tree JSON, close to PageDoc | No, flow with drag and drop | Fallback only |
| Craft.js 0.2.12 | MIT | last release and commit Feb 2025 | React 16-19 peers; client only | Node tree JSON | No (build it yourself) | No (stale) |
| Builder.io | SDKs and Mitosis MIT; visual editor is SaaS | active | Good SDKs | Builder JSON | Flow plus absolute | No (SaaS editor) |
| Plasmic | MIT outside `platform/`, AGPL for `platform/` (the studio) | active | Codegen, loader | Own tree | Flow plus absolute | No (AGPL, own model) |
| Easyblocks | AGPL-3.0, custom licence on request | last push 2024-08 | React | Own config JSON | Flow | No (AGPL, stale) |
| Webstudio | AGPL-3.0 (or later); one proprietary animation package | push 2026-11-21 | Remix app, not an embeddable library | Own Instance tree | Flow, CSS panel | No (AGPL, not embeddable) |
| Onlook | Apache-2.0 | push 2026-11-26 | An app that edits Next code, not a library | Edits TSX via AST | Flow | Study only |
| tldraw 5.6.2 | Custom licence: dev free, production needs trial or commercial key | active | React | Own shapes, canvas | Yes | No (licence, not HTML) |
| Polotno | Commercial; free only for non-commercial; paid from about $199/month for under 50 staff (per their page), source access extra | active | React/MobX | Own JSON, canvas | Yes | No (bitmap output) |
| react-konva / Fabric | MIT | active | React | Canvas bitmap | Yes | No (no SEO) |
| react-moveable 0.56.0 | MIT | last release 2023-12 | Fine, framework-agnostic | n/a (handles) | Handles, snap guides | Fork or reimplement |
| Tiptap 3.x | MIT core | release 2026-11-20 | Fine | HTML/JSON text | n/a | Yes, inline text |
| Lexical, Plate | MIT | active | Fine | Own JSON | n/a | Alternates for text |

Reka and a Tailwind-aware Plate wrapper were not researched in depth. They add nothing the above does not cover.

## Per-candidate notes

**GrapesJS (and `@grapesjs/react`).** Open core is BSD-3-Clause per npm, 26k stars, still shipping. The React wrapper is MIT. It is the only OSS editor with true free placement, layers, style manager, responsive device modes and undo. The cost is the model: it stores HTML and CSS in its own component tree and renders inside its own iframe. Our storefront renders a safe AST on the server with real parts and data. We would write two-way converters (AST to GrapesJS components and back), lose `data-e` ids, and lose the AI round-trip (TSX to tree). Live store data parts would need custom component types that the GrapesJS iframe cannot render without the real renderer. The Studio SDK adds a nicer UI but needs a licence key and white-label is Enterprise, which conflicts with reselling an editor to many stores. MVP 8-10 weeks, production 6+ months with converter bugs. Risk: fidelity loss and a second renderer.

**Puck.** MIT, very active (0.24.2 on 2026-11-23, moved to `@puckeditor/core`; the old `@measured/puck` is deprecated at 0.20.2). Native React, works with App Router, Data is `{content, zones}` JSON that maps cleanly to `PageDoc` blocks and slots. Newer releases add a drag engine for multi-column drops, rich text and an AI plugin (the AI parts are beta and tied to their cloud client). It has no free placement, no resize handles, no style panel and no breakpoint model. It would replace our block list, not add a canvas. MVP 3-4 weeks for a block-level editor, which we already have. Use only if we need a quick fallback editor. Risk: duplicating what exists, and API churn at 0.x.

**Craft.js.** MIT and clean, but the last release and commit are from February 2025 and one person maintains it. It renders React components in its own tree, so it would need a parallel renderer to our server one. No.

**Builder.io.** Mitosis (MIT) compiles components across frameworks; it does not help us. The SDKs (MIT) render Builder content, but the visual editor is the SaaS product, and content lives in their cloud. Wrong for a reseller. No.

**Plasmic.** The repo is MIT except `platform/` (the studio), which is AGPL. Self-hosting the studio is possible but heavy, and AGPL means modifications must be published when we offer it as a service. Its model is its own tree with codegen to React. No.

**Easyblocks.** AGPL-3.0 with a custom licence offered on request. Last push August 2024, 582 stars. Design is strong (config-driven, responsive values) but the project looks dormant. No.

**Webstudio.** Best open-source analogue of what we want (Tailwind-like style panel, breakpoints, data bindings), 9k stars, active. But AGPL-3.0-or-later, a full Remix app, and its own Instance model. Not embeddable. Good source of UX ideas, not code. No.

**Onlook.** Apache-2.0, active, edits real Next/Tailwind code through AST changes. Same idea as our `compile` and `print` round-trip. It is a desktop-style app, not a library. Study its approach to source mapping.

**tldraw.** Excellent canvas (snapping, multi-select, undo, groups) but production use needs a trial or commercial licence key with a watermark and usage reporting, and the output is a whiteboard document, not HTML. No.

**Polotno, react-konva, Fabric.** Canva-like out of the box for graphics. Output is a bitmap or its own JSON, so no SEO, no accessibility, no live product lists. Polotno also needs a paid licence. Good for a separate "design a banner/social image" tool, not for site pages.

**Small parts we adopt.**
- Handles and guides: react-moveable (MIT, 0.56.0) is feature complete but untouched since Dec 2023. Phase 3 already plans our own `snap.ts` and an interface (`LayerHandles`) that a library could replace. Build ours (about 1 week) and keep Moveable as a fallback.
- Inline rich text: Tiptap 3 (MIT, already installed for `EmailComposer`).
- Layers tree and drag from library: dnd-kit (already installed).

## Effort (engineer-weeks, one engineer)

| Path | MVP | Production |
|---|---|---|
| Finish phase 3 free layers on our editor (recommended) | 3 | 6 |
| Add "slide" sections (absolute frame, fixed aspect, scaled) on top | +2 | +3 |
| Adopt Puck as the block editor | 3-4 | 8 (still no canvas) |
| Adopt GrapesJS with converters | 8-10 | 24+ |
| Polotno/tldraw for pages | not viable (output is not HTML) | n/a |

These are rough estimates based on the existing code size and the phase 3 slice list, not measurements.

## Recommended architecture

1. **Keep the pipeline.** Draft is a `PageDoc`; code sections hold a tree plus `source`. The editor saves trees with empty `source`. Source editors and the AI write `source`, which wins and rebuilds the tree (the contract from SITE_EDITOR_PLAN). Publish is unchanged. The storefront interprets the AST on the server (RSC), so no editor code ships to shoppers.
2. **Canvas layer = free layers.** Any element can become `absolute` inside its frame, placed in % with a z step (`lg:left-[12%] lg:top-[30%] lg:w-[40%]`). Selection, multi-select, resize, rotate, snap to edges, centre, siblings and fractions, and layer order live in the editor bridge in the preview iframe. Rotate and group are new work.
3. **Flow stays the default; add a "slide" section type.** A slide is a frame with a design aspect (for example 16:9 on desktop) holding free layers, scaled by container width with CSS `container` units, and falling back to a stacked flow on phones. This gives Canva-style freedom where the owner wants a poster-like hero without making the whole page absolute. Reasons not to go fully absolute: phone reflow, reading order and SEO, variable-length product lists, and AI-written sections that assume flow.
4. **Live data.** Data parts (`Products`, `Categories`, and so on) are real components in the iframe, so they show real data. In a slide they are placed as a free layer with a fixed box and an internal grid that clips or paginates. Owners resize the box, not the items.
5. **Breakpoints.** Keep one document with Phone (base), Tablet (`md:`), Desktop (`lg:`). Free layers are placed per breakpoint; unplaced breakpoints fall back to flow (already designed).
6. **Text.** Double-click edits in place; Tiptap only for multi-paragraph rich text; plain text stays a literal write.
7. **AI.** The AI keeps writing code sections. Add free-layer rules to `EDITOR_RULES` (keep `data-e`, free layers only in a `relative` frame) and a critique check for layers off the phone screen.

## Phased plan

| Phase | Scope | Weeks |
|---|---|---|
| A | Phase 3 slices 1-3: free layer model, handles, snap, multi-select, phone fallback | 3 |
| B | Rotate, group and ungroup, align and distribute, nudge keys, copy and paste across sections | 2 |
| C | "Slide" section type with aspect scaling and templates; AI generates slides | 3 |
| D | Accessibility pass (keyboard move and resize, focus order, labels), perf, audit sweep on templates | 2 |
| E | Optional: Puck-style block palette or Tiptap rich text polish | 1-2 |

Cut line for a first release: A only.

## Risks

- Percent-based placement breaks when copy or fonts change length. Mitigate with min-height on frames, an overflow check in the critique, and previews at all three widths.
- Multi-select and group need a tree operation that keeps `data-e` ids stable and the AST valid. Add them to the property tests (`site-code-roundtrip`).
- Handles inside an iframe: pointer capture and scroll need care; zoom in the canvas is not built.
- Licences: nothing we adopt is copyleft. Do not copy code from Webstudio, Plasmic `platform/`, or Easyblocks (AGPL) into a resold product.

## Open questions

1. Is a slide section a new block type, or a variant of the existing code section?
2. Do we want rotation? It adds transform handling to the safe class allowlist.
3. Should phone placements be per layer by default, or scale desktop placement down?
4. Is a separate image/banner designer (Polotno or tldraw with a paid licence) wanted later? It is a different product from page editing.
5. Do we want to pay for any editor licence at all? This research assumes no.
6. Confirm GrapesJS's licence file wording if it is ever reconsidered (GitHub reports NOASSERTION; npm says BSD-3-Clause).

## Sources

- GrapesJS: https://github.com/GrapesJS/grapesjs, https://www.npmjs.com/package/grapesjs, https://grapesjs.com/sdk/pricing
- Puck: https://github.com/puckeditor/puck, https://puckeditor.com/blog/puck-ai-08
- Craft.js: https://github.com/prevwong/craft.js
- Builder.io and Mitosis: https://github.com/BuilderIO/builder, https://github.com/BuilderIO/mitosis
- Plasmic: https://github.com/plasmicapp/plasmic (README licence split)
- Easyblocks: https://github.com/easyblockshq/easyblocks, https://docs.easyblocks.io/
- Webstudio: https://github.com/webstudio-is/webstudio, https://docs.webstudio.is/basics/faq
- Onlook: https://github.com/onlook-dev/onlook
- tldraw: https://github.com/tldraw/tldraw/blob/main/LICENSE.md
- Polotno: https://polotno.com/pricing, https://polotno.com/sdk/pricing-update
- Moveable: https://github.com/daybrush/moveable; Tiptap: https://github.com/ueberdosis/tiptap
