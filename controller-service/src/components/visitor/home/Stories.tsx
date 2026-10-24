'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import StoreImage from '@/components/visitor/StoreImage'
import StoryViewer from './StoryViewer'
import { SECTION_COPY_DEFAULTS, type StoryGroup } from '@/lib/catalog/homepage-sections'

const COPY = SECTION_COPY_DEFAULTS.stories

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

  if (groups.length === 0) return null

  return (
    <section className="bg-surface py-10 md:py-14">
      <div className="container mx-auto px-4">
        <div className="mb-5 flex items-center gap-4">
          <div className="h-10 w-1 rounded-full bg-accent-500" />
          <div>
            <p className="mb-1 text-[10px] font-black uppercase tracking-[0.2em] text-accent-500">{eyebrow ?? COPY.eyebrow}</p>
            <h2 className="text-2xl font-black tracking-tight text-foreground md:text-4xl">{title ?? COPY.title}</h2>
          </div>
        </div>

        <ul
          aria-label="Stories"
          className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {groups.map((group, i) => {
            const isSeen = seen[group.id] === group.slides.length
            const n = group.slides.length
            return (
              <li key={group.id} className="shrink-0 snap-start">
                <button
                  type="button"
                  onClick={() => setOpenIndex(i)}
                  aria-label={`${group.title}, ${n} ${n === 1 ? 'story' : 'stories'}${isSeen ? ', seen' : ''}`}
                  className="group flex w-20 flex-col items-center gap-2 md:w-24"
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
                        wrapperClassName="relative h-16 w-16 overflow-hidden rounded-full md:h-[4.5rem] md:w-[4.5rem]"
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
      </div>

      <AnimatePresence>
        {openIndex !== null && (
          <StoryViewer key="viewer" groups={groups} startIndex={openIndex} onClose={close} onGroupOpen={markSeen} />
        )}
      </AnimatePresence>
    </section>
  )
}
