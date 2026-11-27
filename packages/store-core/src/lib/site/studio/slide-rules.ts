import type { CodeNode } from '@jeffi/site-blocks'
import { freeAt } from '../code/free'
import { DATA_PARTS, FRAME_CONTAINER, SLIDE_ASPECTS, aspectIn, classOf, forEachNode, isSlide, pxText, slideFrameClasses } from '../code/slide'
import { splitClasses } from '../code/allow'

// How the section writer makes a slide (lib/site/code/slide.ts): the rules for its prompt, and a check of what it wrote.

export const SLIDE_RULES = [
  'This section is a SLIDE: a fixed-shape composition that looks the same at any width, like a poster.',
  `- The root element is the slide frame with exactly these classes first: ${slideFrameClasses()} (plus phone classes such as flex flex-col gap-4 px-5 py-10 and colours). Other aspects: ${SLIDE_ASPECTS.map(a => `md:aspect-[${a.w}/${a.h}]`).join(', ')}.`,
  '- Every direct child of the frame is a free layer, placed at BOTH md and lg in % of the frame: md:absolute md:left-[8%] md:top-[20%] md:w-[50%] md:z-10 lg:absolute lg:left-[8%] lg:top-[20%] lg:w-[50%] lg:z-10. Layers are elements (no loose text) with no wrapper around them; keep each inside the frame (left + width ≤ 100%, top + height ≤ 100%). Do not use absolute anywhere deeper, or on phones.',
  '- Size words in container units from md: up, on the layer that holds them: md:text-[4.2cqw] for a heading, md:text-[1.8cqw] for a line of body text (1cqw is 1% of the slide width; never px or rem sizes at md and lg). Padding and radius on a layer may use cqw too: md:px-[1.6cqw] md:rounded-[1.6cqw].',
  '- On phones the layers stack in the flow in the order you write them (reading order), with normal phone sizes: text-4xl for the heading, text-base for body text, w-full pictures, buttons min-h-12. Write them in the order they should read on a phone.',
  '- A picture layer is <Image> with an aspect (aspect="4:5") and a width in %, no height; a live part (<Products>, <Categories>…) is a layer with a width AND a height in % (md:h-[84%]) and overflow-hidden, never sized by its items.',
  '- Keep the data-e attribute exactly as it is on every element you keep; give new elements no data-e.',
].join('\n')

/** A planned layout that asks for a slide (`slide: …`), or a section's source already written as one. */
export const isSlideLayout = (text: string) => /^slide\b/i.test(text.trim()) || text.includes(FRAME_CONTAINER)

const past = (r: { left: number; top: number; width: number; height?: number }) => r.left < 0 || r.top < 0 || r.left + r.width > 100.5 || (r.height !== undefined && r.top + r.height > 100.5)

/** What is wrong with a section written as a slide, as lines for the writer to repair; [] for a section that is not one. */
export function lintSlide(tree: CodeNode | null | undefined): string[] {
  if (!tree || tree.t !== 'el') return []
  const root = classOf(tree) ?? ''
  const tokens = splitClasses(root)
  const half = tokens.includes(FRAME_CONTAINER) !== (aspectIn(root) !== null)
  const out: string[] = []
  if (half) out.push(`A slide frame needs both ${FRAME_CONTAINER} and an md:aspect-[w/h] on the root: ${slideFrameClasses()}.`)
  if (!isSlide(tree)) return out
  if (!tokens.includes('relative')) out.push('The slide frame needs relative.')
  tree.children.forEach(c => {
    if (c.t !== 'el' && c.t !== 'cmp') {
      out.push('Every direct child of the slide frame must be an element placed as a layer: no loose text, conditions or fragments.')
      return
    }
    const cls = classOf(c)
    if (cls === null) {
      out.push('A slide layer\'s className must be written out as plain classes.')
      return
    }
    for (const bp of ['md', 'lg'] as const) {
      const at = freeAt(cls, bp)
      if (!at) out.push(`A slide layer (<${c.t === 'el' ? c.tag : c.name}>) is not placed at ${bp}: give it ${bp}:absolute ${bp}:left-[x%] ${bp}:top-[y%] ${bp}:w-[w%].`)
      else if (past(at.rect)) out.push(`A slide layer (<${c.t === 'el' ? c.tag : c.name}>) runs past the slide at ${bp}: keep left + width within 100% and top + height within 100%.`)
    }
    if (freeAt(cls, 'base')) out.push('Slide layers are in the flow on phones: no absolute at the base, only from md: up.')
    if (c.t === 'cmp' && DATA_PARTS.has(c.name) && (freeAt(cls, 'md')?.rect.height === undefined || !splitClasses(cls).some(t => t === 'overflow-hidden' || t === 'md:overflow-hidden')))
      out.push(`<${c.name}> in a slide needs a height in % and overflow-hidden (a fixed box; it is never sized by its items).`)
    // Free layers deeper down would leave the frame the layers are measured against.
    forEachNode(c, n => {
      if (n === c) return
      const k = classOf(n)
      if (k && (freeAt(k, 'md') || freeAt(k, 'lg'))) out.push('Only the slide frame\'s direct children are placed freely; inside a layer use normal flow.')
    })
  })
  if (pxText(tree).length) out.push('Words in a slide are sized in container units from md: up (md:text-[4.2cqw] on the layer), never px or Tailwind sizes at md and lg.')
  return [...new Set(out)]
}
