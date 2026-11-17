'use client'

import { useState } from 'react'
import { ArrowLeft, ArrowRight, Loader2, Sparkles } from 'lucide-react'
import { ChoiceChips } from '../../_ui'
import { fieldInput, ghostBtn, primaryBtn, secondaryBtn } from '../ui'
import { StylePicker } from './StylePreview'
import type { StudioAnswers } from '@/lib/site/studio/types'

// The brief: five short questions, one at a time, each with "Help me answer" (an AI suggestion the owner can edit)
// and, where it is optional, "Skip".

export type BriefKey = 'sell' | 'audience' | 'mood' | 'uiStyle' | 'references' | 'notes'
type Key = BriefKey

/** Wording for another kind of site (a Showcase's): per question, and the finish button. */
export type BriefCopy = Partial<Record<Key, { title?: string; hint?: string; placeholder?: string }>> & { finish?: string; finishing?: string }

const ALL: { key: Key; title: string; hint: string; placeholder?: string; optional?: boolean; help?: boolean }[] = [
  { key: 'sell', title: 'What do you sell?', hint: 'The products, materials and range.', placeholder: 'e.g. Handwoven Kanchipuram silk sarees, dupattas and blouse pieces', help: true },
  { key: 'audience', title: 'Who buys from you?', hint: 'Who your customers are and why they come to you.', placeholder: 'e.g. Brides and their families shopping for weddings', optional: true, help: true },
  { key: 'mood', title: 'How should your site feel?', hint: 'Pick a few words or write your own.', placeholder: 'e.g. Rich and traditional, with lots of gold', optional: true, help: true },
  { key: 'uiStyle', title: 'Pick a design style', hint: 'Every page follows it. Each card previews its type, buttons and cards; or let the AI show you three different ones.', optional: true },
  { key: 'references', title: 'Any sites you like?', hint: 'Up to three. The AI takes their feel, never their words or pictures.', optional: true },
  { key: 'notes', title: 'Anything else?', hint: 'What makes your store special. Your logo is used too.', placeholder: 'e.g. Family weavers since 1962; every saree has a silk mark', optional: true, help: true },
]

const MOODS = ['Warm & festive', 'Minimal & modern', 'Bold & playful', 'Luxurious', 'Earthy & natural', 'Clean & techy', 'Traditional', 'Youthful']
const HTTPS_URL = /^https:\/\/[^\s/$.?#][^\s]*$/i

export default function BriefStep({
  answers,
  logoUrl,
  storeName,
  onSave,
  onHelp,
  onFinish,
  finishing,
  copy,
}: {
  answers: Partial<StudioAnswers>
  logoUrl: string | null
  storeName: string
  onSave: (a: Partial<StudioAnswers>) => void
  onHelp: (key: Key, a: Partial<StudioAnswers>) => Promise<string | null>
  onFinish: (a: Partial<StudioAnswers>) => void
  finishing: boolean
  copy?: BriefCopy
}) {
  const QUESTIONS = copy ? ALL.map(x => ({ ...x, ...copy[x.key] })) : ALL
  const [i, setI] = useState(0)
  const [a, setA] = useState<Partial<StudioAnswers>>(() => ({ ...answers, references: [0, 1, 2].map(n => answers.references?.[n] ?? '') }))
  const [helping, setHelping] = useState(false)
  const q = QUESTIONS[i]
  const last = i === QUESTIONS.length - 1
  const refs = (a.references ?? []).map(r => r.trim())
  const refsOk = refs.every(r => !r || HTTPS_URL.test(r))
  const moodWords = (a.mood ?? '').split(/,\s*/).filter(Boolean)
  const value = (k: Key) => (k === 'references' || k === 'uiStyle' ? '' : String(a[k] ?? ''))
  const clean = (x: Partial<StudioAnswers>) => ({ ...x, references: (x.references ?? []).map(r => r.trim()).filter(Boolean) })
  const canNext = q.key === 'sell' ? value('sell').trim().length >= 3 : q.key === 'references' ? refsOk : true

  const go = (to: number) => {
    onSave(clean(a))
    setI(to)
  }
  const help = async () => {
    setHelping(true)
    const s = await onHelp(q.key, clean(a))
    setHelping(false)
    if (s) setA(x => ({ ...x, [q.key]: s }))
  }

  return (
    <div>
      <div className="mb-5 flex items-center gap-1.5" aria-hidden>
        {QUESTIONS.map((x, n) => (
          <span key={x.key} className={`h-1.5 flex-1 rounded-full transition-colors ${n <= i ? 'ecom-accent-bg' : 'bg-surface-secondary'}`} />
        ))}
      </div>
      <div className="text-xs font-semibold uppercase tracking-widest text-foreground-muted">
        Question {i + 1} of {QUESTIONS.length}
        {q.optional && <span className="ml-2 normal-case tracking-normal font-normal">(optional)</span>}
      </div>
      <label htmlFor={`studio-q-${q.key}`} className="mt-1 block font-display text-2xl font-black text-foreground">
        {q.title}
      </label>
      <p className="mt-1 text-sm text-foreground-secondary">{q.hint}</p>

      <div className="mt-4">
        {q.key === 'uiStyle' ? (
          <StylePicker value={a.uiStyle ?? null} onChange={id => setA(x => ({ ...x, uiStyle: id }))} storeName={a.storeName || storeName} />
        ) : q.key === 'references' ? (
          <div className="space-y-2">
            {[0, 1, 2].map(n => (
              <input
                key={n}
                id={n === 0 ? 'studio-q-references' : undefined}
                type="url"
                inputMode="url"
                aria-label={`Site you like ${n + 1}`}
                className={fieldInput}
                placeholder="https://"
                value={a.references?.[n] ?? ''}
                onChange={e => setA(x => ({ ...x, references: [0, 1, 2].map(m => (m === n ? e.target.value : x.references?.[m] ?? '')) }))}
              />
            ))}
            {!refsOk && <p className="text-xs text-red-600">Links must start with https://</p>}
          </div>
        ) : (
          <>
            {q.key === 'mood' && (
              <ChoiceChips
                multiple
                ariaLabel="Mood"
                className="mb-3"
                value={MOODS.filter(m => moodWords.includes(m))}
                onChange={picked => setA(x => ({ ...x, mood: [...picked, ...moodWords.filter(w => !MOODS.includes(w))].join(', ') }))}
                options={MOODS.map(m => ({ value: m, label: m }))}
              />
            )}
            <textarea
              id={`studio-q-${q.key}`}
              className={`${fieldInput} min-h-24`}
              maxLength={q.key === 'sell' ? 1200 : 400}
              placeholder={q.placeholder}
              value={value(q.key)}
              onChange={e => setA(x => ({ ...x, [q.key]: e.target.value }))}
            />
          </>
        )}
        {q.key === 'notes' && logoUrl && (
          <div className="mt-3 flex items-center gap-3 rounded-xl bg-surface-secondary/60 px-3 py-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoUrl} alt="Your logo" className="h-9 w-9 rounded-lg bg-white object-contain p-1" />
            <span className="text-xs text-foreground-secondary">Your logo is part of the design.</span>
          </div>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {q.help && (
          <button type="button" onClick={help} disabled={helping || finishing} className={secondaryBtn}>
            {helping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {helping ? 'Thinking…' : 'Help me answer'}
          </button>
        )}
        {q.optional && !last && (
          <button type="button" onClick={() => go(i + 1)} disabled={finishing} className={ghostBtn}>
            Skip
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          {i > 0 && (
            <button type="button" onClick={() => go(i - 1)} disabled={finishing} className={ghostBtn} aria-label="Previous question">
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          {last ? (
            <button type="button" onClick={() => onFinish(clean(a))} disabled={finishing || !refsOk || value('sell').trim().length < 3} className={primaryBtn}>
              {finishing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {finishing ? (copy?.finishing ?? 'Planning your pages…') : (copy?.finish ?? 'Plan my pages')}
              {!finishing && <ArrowRight className="h-4 w-4" />}
            </button>
          ) : (
            <button type="button" onClick={() => go(i + 1)} disabled={!canNext} className={primaryBtn}>
              Next <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      {finishing && <p className="mt-3 text-xs text-foreground-muted">Reading your answers and the sites you like. This takes up to a minute.</p>}
    </div>
  )
}
