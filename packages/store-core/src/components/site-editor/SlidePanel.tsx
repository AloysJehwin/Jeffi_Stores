'use client'

import { Monitor, Undo2 } from 'lucide-react'
import type { CodeNode } from '@jeffi/site-blocks'
import type { Breakpoint } from '@jeffi/site-blocks/design'
import { SLIDE_ASPECTS, aspectOf, isSlide, slideLayers } from '@/lib/site/code/slide'
import { BREAKPOINT_NAME } from './StylePanel'

// The section as a slide: a fixed-shape frame from Tablet up whose layers are placed in % and whose words scale with
// it, stacked in reading order on phones. For a slide, its shape and the way back; for another code section, the way in.

export interface SlidePanelProps {
  /** The code section's tree (its root is the slide frame, or a flow section that could become one). */
  tree: CodeNode
  bp: Breakpoint
  canWrite: boolean
  onAspect: (aspect: string) => void
  /** Back to a normal section: layers into the flow, frame classes dropped. */
  onFlow: () => void
  /** A normal code section made a slide (the shell measures its elements and passes them to makeSlideOps). */
  onMake: () => void
}

export default function SlidePanel({ tree, bp, canWrite, onAspect, onFlow, onMake }: SlidePanelProps) {
  const btn = 'inline-flex items-center gap-1 rounded-md border border-border-default px-2 h-7 text-xs text-foreground-secondary hover:text-foreground disabled:opacity-40'
  if (!isSlide(tree)) {
    return (
      <section className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Slide</p>
        <p className="text-[11px] text-foreground-muted">
          A slide keeps one shape from Tablet up, like a poster: each element becomes a layer you place anywhere, and its words scale with the slide. On phones the layers stack in reading order.
        </p>
        {canWrite && (
          <button type="button" className={btn} onClick={onMake}>
            <Monitor className="h-3.5 w-3.5" /> Make this a slide
          </button>
        )}
      </section>
    )
  }
  const aspect = aspectOf(tree)
  const layers = slideLayers(tree).length
  return (
    <section className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Slide</p>
      <p className="text-[11px] text-foreground-muted">
        {layers === 1 ? '1 layer' : `${layers} layers`}. {bp === 'base' ? 'Phone shows them stacked in reading order, without the shape.' : `${BREAKPOINT_NAME[bp]} keeps the slide's shape at any width.`} Drag layers on the canvas;
        their words scale with the slide.
      </p>
      <div role="group" aria-label="Slide shape" className="flex flex-wrap gap-1.5">
        {SLIDE_ASPECTS.map(a => (
          <button
            key={a.id}
            type="button"
            aria-pressed={aspect === a.id}
            disabled={!canWrite}
            className={`${btn} ${aspect === a.id ? 'border-accent-500 text-foreground' : ''}`}
            onClick={() => aspect !== a.id && onAspect(a.id)}
          >
            {a.label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-foreground-muted">On phones there is no fixed shape: each layer stacks in the page flow, in the order of the Layers list, with normal phone text sizes.</p>
      {canWrite && (
        <button type="button" className={btn} onClick={onFlow}>
          <Undo2 className="h-3.5 w-3.5" /> Back to a normal section
        </button>
      )}
    </section>
  )
}
