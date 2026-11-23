'use client'

import { useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ImagePlus, Loader2, Plus, Sparkles, Star, Trash2 } from 'lucide-react'
import { Card } from '../../../dashboard/_components/Card'
import { fieldInput, fieldLabel, secondaryBtn } from '../../ui'
import { SHOWCASE_LIMITS } from '@/lib/showcase/clean'
import type { ShowcaseContent, ShowcaseFaq, ShowcasePagePicture, ShowcaseReview, ShowcaseService, ShowcaseStat, ShowcaseWork } from '@/lib/showcase/types'
import ImageField from './ImageField'
import { uploadShowcaseImage } from './useShowcaseDetails'
import type { DetailsForm } from './model'

// What the page shows besides the business: services, work samples, what clients say, numbers and questions. Each is
// optional; the page's sections for one stay hidden until it has something.

const inp = fieldInput
const lbl = fieldLabel

type ListKey = Exclude<keyof ShowcaseContent, 'pictures'>

/** An item the owner changed is theirs: the AI's mark goes. */
function edited<T>(item: T, patch: Partial<T>): T {
  const { ai: _ai, ...rest } = { ...item, ...patch } as T & { ai?: boolean }
  return rest as T
}

const SUGGESTED = 'Suggested by AI. Check it, then edit or remove it.'

function ListCard<T>({
  title,
  hint,
  items,
  limit,
  update,
  blank,
  addLabel,
  render,
  extra,
  aiNote = SUGGESTED,
}: {
  title: string
  hint: string
  items: T[]
  limit: number
  /** Changes the list from its latest state (an upload finishing late keeps edits made meanwhile). */
  update: (fn: (items: T[]) => T[]) => void
  blank: () => T
  addLabel: string
  render: (item: T, set: (patch: Partial<T>) => void, i: number) => ReactNode
  extra?: ReactNode
  /** What an item the AI suggested or made says until the owner edits it. */
  aiNote?: string
}) {
  const move = (i: number, by: number) =>
    update(list => {
      const next = [...list]
      const [it] = next.splice(i, 1)
      next.splice(i + by, 0, it)
      return next
    })
  return (
    <Card title={title}>
      <p className="-mt-2 mb-4 text-xs text-foreground-muted">{hint}</p>
      <ol className="space-y-3">
        {items.map((item, i) => (
          <li key={i} className="rounded-xl border border-border-default bg-surface p-3 sm:p-4">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                {(item as { ai?: boolean }).ai && (
                  <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-surface-secondary px-2.5 py-1 text-xs text-foreground-secondary">
                    <Sparkles className="h-3.5 w-3.5" /> {aiNote}
                  </p>
                )}
                {render(item, patch => update(list => list.map((x, j) => (j === i ? edited(x, patch) : x))), i)}
              </div>
              <div className="flex shrink-0 flex-col gap-1">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" className="ecom-focus rounded-lg p-1.5 text-foreground-muted ecom-hover hover:text-foreground disabled:opacity-30">
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label="Move down" className="ecom-focus rounded-lg p-1.5 text-foreground-muted ecom-hover hover:text-foreground disabled:opacity-30">
                  <ArrowDown className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => update(list => list.filter((_, j) => j !== i))} aria-label="Remove" className="ecom-focus rounded-lg p-1.5 text-foreground-muted ecom-hover hover:text-[#8a2e1f]">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {items.length < limit && (
          <button type="button" onClick={() => update(list => [...list, blank()].slice(0, limit))} className={secondaryBtn}>
            <Plus className="h-4 w-4" /> {addLabel}
          </button>
        )}
        {extra}
        {items.length >= limit && <span className="text-xs text-foreground-muted">Up to {limit}.</span>}
      </div>
    </Card>
  )
}

/** Several work pictures at once: each uploaded becomes a work sample to caption. */
function AddPictures({ room, onAdd }: { room: number; onAdd: (urls: string[]) => void }) {
  const [busy, setBusy] = useState(0)
  const [error, setError] = useState<string | null>(null)
  async function pick(files: File[]) {
    setError(null)
    const list = files.slice(0, room)
    setBusy(list.length)
    const urls: string[] = []
    for (const f of list) {
      try {
        urls.push(await uploadShowcaseImage(f, 'work'))
      } catch (e) {
        setError((e as Error).message)
      }
      setBusy(n => n - 1)
    }
    if (urls.length) onAdd(urls)
  }
  return (
    <>
      <label className={`${secondaryBtn} cursor-pointer ${busy ? 'pointer-events-none opacity-60' : ''}`}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
        {busy ? `Uploading ${busy}…` : 'Add pictures'}
        <input
          type="file"
          accept=".png,.jpg,.jpeg,.webp"
          multiple
          className="sr-only"
          disabled={!!busy || room <= 0}
          onChange={e => {
            const files = [...(e.target.files ?? [])]
            e.target.value = ''
            if (files.length) void pick(files)
          }}
        />
      </label>
      {error && <span className="text-xs text-[#8a2e1f]">{error}</span>}
    </>
  )
}

function Stars({ value, onChange }: { value: number | undefined; onChange: (v: number | undefined) => void }) {
  return (
    <div className="flex items-center gap-0.5" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n === 1 ? '' : 's'}`}
          onClick={() => onChange(value === n ? undefined : n)}
          className="ecom-focus rounded p-0.5 text-[#c99a2e]"
        >
          <Star className={`h-5 w-5 ${value && n <= value ? 'fill-current' : 'opacity-35'}`} />
        </button>
      ))}
    </div>
  )
}

export default function ContentFields({ form, setForm }: { form: DetailsForm; setForm: (f: (f: DetailsForm) => DetailsForm) => void }) {
  const c = form.content
  const setList =
    <K extends ListKey>(key: K) =>
    (fn: (items: ShowcaseContent[K]) => ShowcaseContent[K]) =>
      setForm(f => ({ ...f, content: { ...f.content, [key]: fn(f.content[key]) } }))

  return (
    <div className="space-y-4">
      <ListCard<ShowcaseService>
        title="Services"
        hint="What you offer, with a price when you want to show one."
        items={c.services}
        limit={SHOWCASE_LIMITS.services}
        update={setList('services')}
        blank={() => ({ title: '', description: '', price: '', image: null })}
        addLabel="Add a service"
        render={(s, set, i) => (
          <div className="flex flex-col gap-3 sm:flex-row">
            <ImageField value={s.image} onChange={image => set({ image })} kind="service" label="Picture (optional)" className="h-24 w-24" />
            <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-[1fr_10rem]">
              <div>
                <label htmlFor={`sv-title-${i}`} className={lbl}>
                  Service
                </label>
                <input id={`sv-title-${i}`} className={inp} maxLength={120} placeholder="e.g. Wedding photography" value={s.title} onChange={e => set({ title: e.target.value })} />
              </div>
              <div>
                <label htmlFor={`sv-price-${i}`} className={lbl}>
                  Price
                </label>
                <input id={`sv-price-${i}`} className={inp} maxLength={60} placeholder="e.g. From ₹25,000" value={s.price ?? ''} onChange={e => set({ price: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor={`sv-desc-${i}`} className={lbl}>
                  Description
                </label>
                <textarea id={`sv-desc-${i}`} className={`${inp} h-20 resize-y`} maxLength={600} value={s.description ?? ''} onChange={e => set({ description: e.target.value })} />
              </div>
            </div>
          </div>
        )}
      />

      <ListCard<ShowcaseWork>
        title="Your work"
        hint="Pictures of what you have done, with a caption and a link when there is one."
        items={c.work}
        limit={SHOWCASE_LIMITS.work}
        update={setList('work')}
        blank={() => ({ title: '', description: '', image: '', link: '' })}
        addLabel="Add one"
        extra={
          <AddPictures
            room={SHOWCASE_LIMITS.work - c.work.length}
            onAdd={urls =>
              setForm(f => ({ ...f, content: { ...f.content, work: [...f.content.work, ...urls.map(image => ({ title: '', description: '', image, link: '' }))].slice(0, SHOWCASE_LIMITS.work) } }))
            }
          />
        }
        render={(w, set, i) => (
          <div className="flex flex-col gap-3 sm:flex-row">
            <ImageField value={w.image} onChange={image => set({ image: image ?? '' })} kind="work" label="Picture" className="h-24 w-24" />
            <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor={`wk-title-${i}`} className={lbl}>
                  Title
                </label>
                <input id={`wk-title-${i}`} className={inp} maxLength={120} value={w.title} onChange={e => set({ title: e.target.value })} />
              </div>
              <div>
                <label htmlFor={`wk-link-${i}`} className={lbl}>
                  Link
                </label>
                <input id={`wk-link-${i}`} className={inp} inputMode="url" maxLength={500} placeholder="https://" value={w.link ?? ''} onChange={e => set({ link: e.target.value.trim() })} />
                {w.link && !/^https:\/\//i.test(w.link) && <p className="mt-1 text-xs text-[#8a2e1f]">Links start with https://</p>}
              </div>
              <div className="sm:col-span-2">
                <label htmlFor={`wk-desc-${i}`} className={lbl}>
                  Description
                </label>
                <input id={`wk-desc-${i}`} className={inp} maxLength={600} value={w.description ?? ''} onChange={e => set({ description: e.target.value })} />
              </div>
              {!w.image && <p className="text-xs text-[#8a2e1f] sm:col-span-2">Add the picture: a work sample shows only with one.</p>}
            </div>
          </div>
        )}
      />

      <ListCard<ShowcasePagePicture>
        title="Pictures for your page"
        hint="Pictures that set the mood, shown after your work photos (never as your work). When you have few work photos, designing your page adds some: free stock photos (credited at the foot of your page) or ones made by AI."
        items={c.pictures ?? []}
        limit={SHOWCASE_LIMITS.pictures}
        update={fn => setForm(f => ({ ...f, content: { ...f.content, pictures: fn(f.content.pictures ?? []) } }))}
        blank={() => ({ image: '', alt: '' })}
        addLabel="Add a picture"
        aiNote="Made by AI for your page. Replace it with your own photo whenever you like."
        render={(p, set, i) => (
          <div className="flex flex-col gap-3 sm:flex-row">
            <ImageField value={p.image} onChange={image => set({ image: image ?? '' })} kind="work" label="Picture" className="h-24 w-24" />
            <div className="min-w-0 flex-1">
              <label htmlFor={`pc-alt-${i}`} className={lbl}>
                What it shows
              </label>
              <input id={`pc-alt-${i}`} className={inp} maxLength={120} placeholder="e.g. Our counter in the morning" value={p.alt ?? ''} onChange={e => set({ alt: e.target.value })} />
            </div>
          </div>
        )}
      />

      <ListCard<ShowcaseReview>
        title="What clients say"
        hint="Reviews from your clients, in their words. Only add real ones."
        items={c.reviews}
        limit={SHOWCASE_LIMITS.reviews}
        update={setList('reviews')}
        blank={() => ({ name: '', quote: '', rating: 5, source: '' })}
        addLabel="Add a review"
        render={(r, set, i) => (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`rv-name-${i}`} className={lbl}>
                Name
              </label>
              <input id={`rv-name-${i}`} className={inp} maxLength={80} value={r.name} onChange={e => set({ name: e.target.value })} />
            </div>
            <div>
              <label htmlFor={`rv-source-${i}`} className={lbl}>
                Where they said it
              </label>
              <input id={`rv-source-${i}`} className={inp} maxLength={60} placeholder="e.g. Google" value={r.source ?? ''} onChange={e => set({ source: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor={`rv-quote-${i}`} className={lbl}>
                Review
              </label>
              <textarea id={`rv-quote-${i}`} className={`${inp} h-20 resize-y`} maxLength={800} value={r.quote} onChange={e => set({ quote: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <span className={lbl}>Rating</span>
              <Stars value={r.rating} onChange={rating => set({ rating })} />
            </div>
          </div>
        )}
      />

      <ListCard<ShowcaseStat>
        title="Numbers"
        hint="Facts you are proud of, such as weddings shot or years in business. Only true ones."
        items={c.stats}
        limit={SHOWCASE_LIMITS.stats}
        update={setList('stats')}
        blank={() => ({ value: '', label: '' })}
        addLabel="Add a number"
        render={(s, set, i) => (
          <div className="grid grid-cols-[7rem_1fr] gap-3">
            <div>
              <label htmlFor={`st-value-${i}`} className={lbl}>
                Number
              </label>
              <input id={`st-value-${i}`} className={inp} maxLength={30} placeholder="500+" value={s.value} onChange={e => set({ value: e.target.value })} />
            </div>
            <div>
              <label htmlFor={`st-label-${i}`} className={lbl}>
                What it counts
              </label>
              <input id={`st-label-${i}`} className={inp} maxLength={80} placeholder="weddings shot" value={s.label} onChange={e => set({ label: e.target.value })} />
            </div>
          </div>
        )}
      />

      <ListCard<ShowcaseFaq>
        title="Questions people ask"
        hint="With your answers: they save you calls and help people decide."
        items={c.faqs}
        limit={SHOWCASE_LIMITS.faqs}
        update={setList('faqs')}
        blank={() => ({ q: '', a: '' })}
        addLabel="Add a question"
        render={(f, set, i) => (
          <div className="space-y-3">
            <div>
              <label htmlFor={`fq-q-${i}`} className={lbl}>
                Question
              </label>
              <input id={`fq-q-${i}`} className={inp} maxLength={200} value={f.q} onChange={e => set({ q: e.target.value })} />
            </div>
            <div>
              <label htmlFor={`fq-a-${i}`} className={lbl}>
                Answer
              </label>
              <textarea id={`fq-a-${i}`} className={`${inp} h-20 resize-y`} maxLength={1500} value={f.a} onChange={e => set({ a: e.target.value })} />
            </div>
          </div>
        )}
      />
    </div>
  )
}
