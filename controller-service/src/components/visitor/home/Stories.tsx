'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence, useReducedMotion } from 'motion/react'
import StoreImage from '@/components/visitor/StoreImage'
import { SlideArrows } from '@/components/visitor/slides/SlideControls'
import StoryViewer from './StoryViewer'
import { SECTION_COPY_DEFAULTS, type StoryGroup } from '@/lib/catalog/homepage-sections'

const COPY = SECTION_COPY_DEFAULTS.stories
const FADE = '2.5rem'
// Each edge fades only while rings hide past it (--fade-l / --fade-r are 0 at that end).
const EDGE_MASK =
  '[-webkit-mask-image:linear-gradient(to_right,transparent,#000_var(--fade-l),#000_calc(100%_-_var(--fade-r)),transparent)] [mask-image:linear-gradient(to_right,transparent,#000_var(--fade-l),#000_calc(100%_-_var(--fade-r)),transparent)]'

/** localStorage: `{ [groupId]: slideCount }`; a group is seen while its count still matches. */
export const STORIES_SEEN_KEY = 'jeffi:stories:seen'

type SeenMap = Record<string, number>

function readSeen(): SeenMap {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORIES_SEEN_KEY) ?? 'null')
    if (!parsed || typeof parsed !== 'object') return {}
    const out: SeenMap = {}
    for (const [id, n] of Object.entries(parsed as Record<string, unknown>)) if (typeof n === 'number') out[id] = n
    return out
  } catch {
    return {}
  }
}

interface StoriesProps {
  groups: StoryGroup[]
  eyebrow?: string | null
  title?: string | null
}

export default function Stories({ groups, eyebrow, title }: StoriesProps) {
  const [seen, setSeen] = useState<SeenMap>({})
  const seenRef = useRef<SeenMap>({})
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  useEffect(() => {
    seenRef.current = readSeen()
    setSeen(seenRef.current)
  }, [])

  const markSeen = useCallback((group: StoryGroup) => {
    if (seenRef.current[group.id] === group.slides.length) return
    seenRef.current = { ...seenRef.current, [group.id]: group.slides.length }
    setSeen(seenRef.current)
    try {
      window.localStorage.setItem(STORIES_SEEN_KEY, JSON.stringify(seenRef.current))
    } catch {
      /* storage unavailable */
    }
  }, [])

  const close = useCallback(() => setOpenIndex(null), [])

  // A few groups share the row; once they overflow it scrolls, with arrows and edge fades.
  const reduced = useReducedMotion()
  const rowRef = useRef<HTMLUListElement>(null)
  const [edges, setEdges] = useState({ overflows: false, atStart: true, atEnd: true })

  useEffect(() => {
    const el = rowRef.current
    if (!el) return
    const sync = () => {
      const max = el.scrollWidth - el.clientWidth
      const x = Math.abs(el.scrollLeft)
      setEdges(prev => {
        const next = { overflows: max > 1, atStart: x <= 1, atEnd: x >= max - 1 }
        return prev.overflows === next.overflows && prev.atStart === next.atStart && prev.atEnd === next.atEnd
          ? prev
          : next
      })
    }
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(el)
    el.addEventListener('scroll', sync, { passive: true })
    return () => {
      observer.disconnect()
      el.removeEventListener('scroll', sync)
    }
  }, [groups.length])

  const page = (d: 1 | -1) => {
    const el = rowRef.current
    if (el) el.scrollBy({ left: d * el.clientWidth * 0.8, behavior: reduced ? 'instant' : 'smooth' })
  }

  if (groups.length === 0) return null

  return (
    <section className="bg-surface py-10 md:py-14">
      <div className="container mx-auto px-4">
        <div className="mb-5 flex items-center gap-4">
          <div className="h-10 w-1 rounded-full bg-accent-500" />
          <div>
            <p className="mb-1 text-[10px] font-black uppercase tracking-[0.2em] text-accent-500">
              {eyebrow ?? COPY.eyebrow}
            </p>
            <h2 className="text-2xl font-black tracking-tight text-foreground md:text-4xl">{title ?? COPY.title}</h2>
          </div>
        </div>

        <div className="relative">
          <ul
            ref={rowRef}
            aria-label="Stories"
            style={
              { '--fade-l': edges.atStart ? '0px' : FADE, '--fade-r': edges.atEnd ? '0px' : FADE } as CSSProperties
            }
            className={`-mx-4 grid grid-flow-col auto-cols-[minmax(5.5rem,1fr)] md:auto-cols-[minmax(6.5rem,1fr)] gap-4 overflow-x-auto overscroll-x-contain snap-x scroll-px-4 px-4 pt-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${edges.overflows ? EDGE_MASK : ''}`}
          >
            {groups.map((group, i) => {
              const isSeen = seen[group.id] === group.slides.length
              const n = group.slides.length
              return (
                <li key={group.id} className="min-w-0 snap-start">
                  <button
                    type="button"
                    onClick={() => setOpenIndex(i)}
                    aria-label={`${group.title}, ${n} ${n === 1 ? 'story' : 'stories'}${isSeen ? ', seen' : ''}`}
                    className="group flex w-full flex-col items-center gap-2"
                  >
                    <span
                      className={`rounded-full p-[3px] transition-transform group-hover:scale-105 group-active:scale-95 motion-reduce:transition-none ${
                        isSeen ? 'bg-border-default' : 'bg-gradient-to-tr from-accent-500 via-primary-500 to-accent-500'
                      }`}
                    >
                      <span className="block rounded-full bg-surface p-[2px]">
                        <StoreImage
                          src={group.cover}
                          alt=""
                          sizes="80px"
                          wrapperClassName="relative h-16 w-16 overflow-hidden rounded-full md:h-20 md:w-20"
                          className="h-full w-full object-cover"
                        />
                      </span>
                    </span>
                    <span
                      className={`w-full truncate text-center text-xs font-medium ${isSeen ? 'text-foreground-muted' : 'text-foreground'}`}
                    >
                      {group.title}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>

          {edges.overflows && (
            <SlideArrows
              variant="rail"
              onPrev={() => page(-1)}
              onNext={() => page(1)}
              prevDisabled={edges.atStart}
              nextDisabled={edges.atEnd}
              prevLabel="Scroll stories left"
              nextLabel="Scroll stories right"
              className="sm:hidden md:flex"
            />
          )}
        </div>
      </div>

      <AnimatePresence>
        {openIndex !== null && (
          <StoryViewer key="viewer" groups={groups} startIndex={openIndex} onClose={close} onGroupOpen={markSeen} />
        )}
      </AnimatePresence>
    </section>
  )
}
