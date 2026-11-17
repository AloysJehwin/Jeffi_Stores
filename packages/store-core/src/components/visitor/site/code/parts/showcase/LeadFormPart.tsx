'use client'

import { useId, useState, type FormEvent } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import type { ShowcaseLeadInput } from '@/lib/showcase/types'

// The Showcase lead form (the LeadForm part): name, and phone and/or email and a message, posted as JSON
// (ShowcaseLeadInput) to the site's lead endpoint. Without an endpoint (the studio preview) it is inert: it checks what
// was typed and says so.

export type LeadField = 'name' | 'phone' | 'email' | 'message'

const input =
  'ui-input w-full rounded-lg border border-border-secondary bg-surface px-4 py-3 text-base text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-primary-500'
const LABEL: Record<LeadField, string> = { name: 'Your name', phone: 'Phone', email: 'Email', message: 'Message' }
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function LeadFormPart({
  endpoint,
  fields,
  submitLabel,
  successText,
  messagePlaceholder,
  className,
}: {
  endpoint: string | null
  fields: LeadField[]
  submitLabel: string
  successText: string
  messagePlaceholder?: string
  className?: string
}) {
  const id = useId()
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const get = (k: string) => String(f.get(k) ?? '').trim()
    const body: ShowcaseLeadInput = { name: get('name'), phone: get('phone') || undefined, email: get('email') || undefined, message: get('message') || undefined, website: get('website') || undefined }
    if (body.name.length < 2) return setError('Please tell us your name.')
    if (body.phone && body.phone.replace(/\D/g, '').length < 10) return setError('Please check your phone number.')
    if (body.email && !EMAIL.test(body.email)) return setError('Please check your email address.')
    if (!body.phone && !body.email) return setError(fields.includes('phone') ? 'Please leave a phone number so we can reach you.' : 'Please leave an email address so we can reach you.')
    setError(null)
    if (!endpoint) return setError('This form starts working once your site is live.')
    setState('sending')
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Could not send')
      setState('sent')
    } catch (err) {
      setState('idle')
      setError((err as Error).message === 'Could not send' ? 'Your message could not be sent. Please try again.' : (err as Error).message)
    }
  }

  if (state === 'sent')
    return (
      <div role="status" className={className ?? 'flex flex-col gap-4'}>
        <p className="flex items-start gap-2 text-base text-foreground">
          <CheckCircle2 aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-primary-600" />
          {successText}
        </p>
      </div>
    )

  return (
    // Without JavaScript the form posts to the endpoint itself, which sends the visitor back to the page.
    <form onSubmit={submit} noValidate action={endpoint ?? undefined} method="post" className={className ?? 'flex flex-col gap-4'}>
      {fields.map(k => (
        <label key={k} htmlFor={`${id}-${k}`} className={`flex flex-col gap-1.5 ${k === 'message' ? 'sm:col-span-2' : ''}`}>
          <span className="text-sm font-medium text-foreground-secondary">{LABEL[k]}</span>
          {k === 'message' ? (
            <textarea id={`${id}-${k}`} name={k} rows={4} maxLength={2000} placeholder={messagePlaceholder ?? 'How can we help?'} className={`${input} min-h-[7rem]`} />
          ) : (
            <input
              id={`${id}-${k}`}
              name={k}
              type={k === 'email' ? 'email' : k === 'phone' ? 'tel' : 'text'}
              inputMode={k === 'phone' ? 'tel' : k === 'email' ? 'email' : undefined}
              autoComplete={k === 'name' ? 'name' : k === 'phone' ? 'tel' : 'email'}
              maxLength={k === 'name' ? 120 : 200}
              required={k === 'name'}
              className={input}
            />
          )}
        </label>
      ))}
      {/* Hidden from people; a bot fills it. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" />
      {error && (
        <p role="alert" className="text-sm text-red-600 sm:col-span-2">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={state === 'sending'}
        className="ui-btn inline-flex min-h-[48px] items-center justify-center gap-2 rounded-lg bg-primary-600 px-6 text-base font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-60 sm:col-span-2 sm:justify-self-start"
      >
        {state === 'sending' && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
        {submitLabel}
      </button>
    </form>
  )
}
