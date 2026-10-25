'use client'

import { safeHref, storyGroups } from '@/lib/catalog/homepage-sections'
import { Grid, HeadingFields, Image, LABEL_CLASS, Note, Text, useSectionBinding, type EditorProps } from './fields'
import TileListEditor, { type Tile } from './TileListEditor'

const MAX_GROUPS = 24
const MAX_SLIDES = 12
// `id` rides along as a hidden tile key so the storefront's "seen" state survives edits.
const SLIDE_KEYS = ['id', 'image', 'caption', 'ctaLabel', 'url', 'seconds']
const BLANK_SLIDE: Tile = { id: '', image: '', caption: '', ctaLabel: '', url: '', seconds: '' }

const BTN_CLASS =
  'px-2 py-1 text-xs font-medium rounded-md border border-border-secondary bg-surface text-foreground hover:bg-surface-secondary disabled:opacity-40 disabled:cursor-not-allowed'

interface GroupDraft {
  id: string
  title: string
  cover: string
  slides: Tile[]
}

const text = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')

function readGroups(raw: unknown): GroupDraft[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((g): g is Record<string, unknown> => !!g && typeof g === 'object')
    .map(g => ({
      id: text(g.id),
      title: text(g.title),
      cover: text(g.cover),
      slides: (Array.isArray(g.slides) ? g.slides : [])
        .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
        .map(s => Object.fromEntries(SLIDE_KEYS.map(k => [k, text(s[k])]))),
    }))
}

// What gets saved: ids minted for anything new, seconds stored as a clamped number or left out.
function serialize(groups: GroupDraft[]) {
  return groups.map(g => ({
    id: g.id || crypto.randomUUID(),
    title: g.title,
    cover: g.cover,
    slides: g.slides.map(s => {
      const secs = parseFloat(s.seconds)
      return {
        id: s.id || crypto.randomUUID(),
        image: s.image,
        caption: s.caption,
        ctaLabel: s.ctaLabel,
        url: s.url,
        ...(Number.isFinite(secs) ? { seconds: Math.min(15, Math.max(2, secs)) } : {}),
      }
    }),
  }))
}

export default function StoriesEditor(props: EditorProps) {
  const { section, canWrite } = props
  const b = useSectionBinding(props)
  const groups = readGroups(b.cfg.groups)
  const shown = storyGroups(section).length
  const badLinks = groups.filter(
    g => (g.cover && !safeHref(g.cover)) || g.slides.some(s => [s.image, s.url].some(v => v && !safeHref(v)))
  ).length

  const commit = (next: GroupDraft[]) => b.saveConfig({ groups: serialize(next) })
  const update = (index: number, patch: Partial<GroupDraft>) =>
    commit(groups.map((g, i) => (i === index ? { ...g, ...patch } : g)))

  function move(index: number, delta: number) {
    const target = index + delta
    if (target < 0 || target >= groups.length) return
    const next = [...groups]
    const [row] = next.splice(index, 1)
    next.splice(target, 0, row)
    commit(next)
  }

  return (
    <Grid>
      <HeadingFields props={props} eyebrowHint="Small line above the ring row, e.g. Fresh today." />

      <div className="sm:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <label className={`${LABEL_CLASS} mb-0`}>Stories</label>
          <button
            type="button"
            disabled={!canWrite || groups.length >= MAX_GROUPS}
            onClick={() => commit([...groups, { id: crypto.randomUUID(), title: '', cover: '', slides: [] }])}
            className={BTN_CLASS}
          >
            Add story
          </button>
        </div>
        <p className="text-[11px] text-foreground-muted mb-2">
          Each story is a ring on the homepage that opens its slides full-screen. Up to {MAX_GROUPS} stories with{' '}
          {MAX_SLIDES} slides each.
        </p>

        {groups.length === 0 && (
          <p className="text-xs text-foreground-muted rounded-lg border border-border-default bg-surface-secondary/40 px-3 py-2">
            No stories yet. Add one to show the ring row on the homepage.
          </p>
        )}

        <div className="space-y-3">
          {groups.map((g, i) => (
            <div key={g.id || `group-${i}`} className="rounded-lg border border-border-default bg-surface-secondary/30 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-foreground truncate">
                  Story {i + 1}
                  {g.title ? ` · ${g.title}` : ''}
                </span>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button type="button" disabled={!canWrite || i === 0} onClick={() => move(i, -1)} className={BTN_CLASS}>
                    Up
                  </button>
                  <button
                    type="button"
                    disabled={!canWrite || i === groups.length - 1}
                    onClick={() => move(i, 1)}
                    className={BTN_CLASS}
                  >
                    Down
                  </button>
                  <button
                    type="button"
                    disabled={!canWrite}
                    onClick={() => commit(groups.filter((_, j) => j !== i))}
                    className={`${BTN_CLASS} text-red-600 dark:text-red-400`}
                  >
                    Remove
                  </button>
                </div>
              </div>

              <Grid>
                <Text
                  label="Title"
                  value={g.title}
                  disabled={!canWrite}
                  placeholder="New this week"
                  onCommit={v => update(i, { title: v })}
                />
                <Image
                  label="Cover image"
                  value={g.cover}
                  disabled={!canWrite}
                  hint="Shown inside the ring; square crops work best."
                  onCommit={v => update(i, { cover: v })}
                />
                <TileListEditor
                  label="Slides"
                  tiles={g.slides}
                  fields={[
                    { key: 'image', label: 'Image', kind: 'image', placeholder: 'https://… or upload' },
                    { key: 'caption', label: 'Caption', kind: 'textarea' },
                    { key: 'ctaLabel', label: 'Button label', placeholder: 'Shop now' },
                    { key: 'url', label: 'Link', placeholder: 'https://… or /products' },
                    { key: 'seconds', label: 'Seconds (2–15)', placeholder: '5' },
                  ]}
                  blank={BLANK_SLIDE}
                  disabled={!canWrite}
                  max={MAX_SLIDES}
                  showIcon={false}
                  itemLabel="Slide"
                  onCommit={slides => update(i, { slides })}
                />
              </Grid>
            </div>
          ))}
        </div>
      </div>

      {groups.length > shown && (
        <Note>
          {groups.length - shown === 1 ? 'One story is' : `${groups.length - shown} stories are`} not shown on the
          storefront yet — each needs a title, a cover image and at least one slide with an image.
        </Note>
      )}
      {badLinks > 0 && (
        <Note>
          Links and images must start with https:// or /. {badLinks === 1 ? 'One story has' : `${badLinks} stories have`}{' '}
          a link that will be ignored.
        </Note>
      )}
    </Grid>
  )
}
