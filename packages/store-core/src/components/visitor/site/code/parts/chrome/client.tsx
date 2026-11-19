'use client'

import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuthOptional } from '@/contexts/AuthContext'
import { useCartOptional } from '@/contexts/CartContext'
import SearchBar from '@/components/visitor/SearchBar'
import MobileDrawer from '@/components/visitor/MobileDrawer'
import { bp } from '@/lib/shared/business-path'
import { portalHere } from '@/lib/site/portal'
import CartLink from './CartLink'

// The header parts that need the browser: the cart count, search, the phone menu and rotating announcements. Outside
// the store's providers (the studio preview) they render inert.

const ICON_LINK = 'flex p-2.5 min-w-[44px] min-h-[44px] items-center justify-center hover:text-accent-500 transition-all active:scale-95 relative group'

export function CartIconPart({ showCount = true, className, demoCount = 0 }: { showCount?: boolean; className?: string; demoCount?: number }) {
  const cart = useCartOptional()
  return <CartLink count={cart ? cart.cartCount : demoCount} showCount={showCount} className={className ? `${ICON_LINK} ${className}` : ICON_LINK} />
}

const searchGlyph = 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'

/** The store's search: the header's expanding search (icon) or an always-open field (bar). */
export function SearchBoxPart({ variant = 'icon', placeholder = 'Search products', className }: { variant?: 'icon' | 'bar'; placeholder?: string; className?: string }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const router = useRouter()
  if (variant === 'icon')
    return (
      <div className={className}>
        <SearchBar isOpen={open} onOpen={() => setOpen(true)} onClose={() => setOpen(false)} />
      </div>
    )
  return (
    <form
      role="search"
      className={className || 'w-full'}
      onSubmit={e => {
        e.preventDefault()
        const q = query.trim()
        if (q) router.push(`/products?search=${encodeURIComponent(q)}`)
      }}
    >
      <label className="relative block">
        <span className="sr-only">Search</span>
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-full border border-border-secondary bg-surface pl-10 pr-4 py-2 text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500"
        />
        <svg aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={searchGlyph} />
        </svg>
      </label>
    </form>
  )
}

const MENU_BUTTON = 'relative p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center hover:text-accent-500 transition-all active:scale-90'
// Written out whole, so the app's stylesheet has them.
const MENU_HIDDEN_FROM = { md: 'md:hidden', lg: 'lg:hidden', xl: 'xl:hidden' } as const

/** The phone menu button, gone from `from` up; opens the store's own menu drawer (links, categories, account, cart). */
export function MenuButtonPart({ className, from = 'lg' }: { className?: string; from?: keyof typeof MENU_HIDDEN_FROM }) {
  const cart = useCartOptional()
  const [open, setOpen] = useState(false)
  const count = cart?.cartCount ?? 0
  return (
    <>
      <button
        type="button"
        className={className || `${MENU_HIDDEN_FROM[from] ?? MENU_HIDDEN_FROM.lg} ${MENU_BUTTON}`}
        onClick={() => cart && setOpen(true)}
        aria-label={count > 0 ? `Open menu, ${count} in cart` : 'Open menu'}
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      {cart && <MobileDrawer isOpen={open} onClose={() => setOpen(false)} />}
    </>
  )
}

/** Announcement messages taking turns every few seconds. */
export function AnnouncementTextPart({ messages, href, interval = 5, className }: { messages: string[]; href?: string | null; interval?: number; className?: string }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (messages.length < 2) return
    const t = setInterval(() => setI(n => (n + 1) % messages.length), Math.max(2, interval) * 1000)
    return () => clearInterval(t)
  }, [messages.length, interval])
  if (!messages.length) return null
  const text = messages[i % messages.length]
  return href ? (
    <Link href={href} className={className || 'underline-offset-2 hover:underline'} aria-live="polite">
      {text}
    </Link>
  ) : (
    <span className={className} aria-live="polite">
      {text}
    </span>
  )
}

const PERSON_GLYPH = 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z'

/** The account link: a person icon (and the label) for a guest; the shopper's initial (and first name) once signed in. */
export function AccountLinkPart({ label, className, preview = false }: { label: string; className?: string; preview?: boolean }) {
  const auth = useAuthOptional()
  const user = preview ? null : (auth?.user ?? null)
  const name = user ? user.firstName?.trim() || user.email.split('@')[0] : ''
  const text = label ? name || label : ''
  return (
    <Link
      href="/account"
      aria-label={user ? `Your account, ${name}` : label || 'Account'}
      className={className || 'inline-flex items-center gap-2 p-2.5 min-h-[44px] font-medium hover:text-accent-500 transition-colors'}
    >
      {user ? (
        <span aria-hidden className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-500 text-sm font-bold uppercase text-white">
          {name.charAt(0) || '·'}
        </span>
      ) : (
        <svg aria-hidden="true" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={PERSON_GLYPH} />
        </svg>
      )}
      {text && <span className="hidden sm:inline max-w-[9rem] truncate">{text}</span>}
    </Link>
  )
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const NEWSLETTER_INPUT =
  'ui-input min-w-0 flex-1 rounded-lg border border-border-secondary bg-surface px-3 py-2.5 text-base sm:text-sm text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500'
const NEWSLETTER_BUTTON = 'ui-btn shrink-0 rounded-lg bg-primary-600 px-4 py-2.5 min-h-[44px] text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-60'

/**
 * Sign-up for the store's offer emails. A signed-in shopper switches them on in one tap (their notification
 * preferences); a guest goes on to create an account with the email they typed, and new accounts get the offers.
 * `preview`: the studio's preview, where nothing is sent.
 */
export function NewsletterFormPart({
  placeholder,
  button,
  inputClassName,
  buttonClassName,
  className,
  preview = false,
}: {
  placeholder: string
  button: string
  inputClassName?: string
  buttonClassName?: string
  className?: string
  preview?: boolean
}) {
  const user = useAuthOptional()?.user ?? null
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const [note, setNote] = useState('')

  // Already getting the offers: say so instead of asking again.
  useEffect(() => {
    if (!user || preview) return
    let live = true
    fetch('/api/user/notification-preferences')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        const offers = (d?.categories as { category: string; email: boolean }[] | undefined)?.find(c => c.category === 'offers')
        if (live && offers?.email) {
          setState('done')
          setNote(`You get our offers at ${user.email}.`)
        }
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [user, preview])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (state === 'busy') return
    if (preview) {
      setState('error')
      setNote('This is a preview: sign-ups work once your store is live.')
      return
    }
    if (user) {
      setState('busy')
      try {
        const r = await fetch('/api/user/notification-preferences', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ categories: [{ category: 'offers', email: true }] }),
        })
        if (!r.ok) throw new Error(String(r.status))
        setState('done')
        setNote(`Done: our offers will reach you at ${user.email}.`)
      } catch {
        setState('error')
        setNote('That did not go through. Please try again.')
      }
      return
    }
    const value = email.trim()
    if (!EMAIL.test(value)) {
      setState('error')
      setNote('Enter a valid email address.')
      return
    }
    const signup = portalHere() === 'business' ? bp('/business/signup') : '/signup'
    router.push(`${signup}?email=${encodeURIComponent(value)}&redirect=${encodeURIComponent(window.location.pathname)}`)
  }

  if (state === 'done')
    return (
      <p role="status" className={className}>
        {note}
      </p>
    )
  return (
    <form onSubmit={onSubmit} noValidate className={className || 'w-full max-w-md'}>
      <div className="flex flex-wrap gap-2">
        <label className="contents">
          <span className="sr-only">Email address</span>
          <input
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={user ? user.email : email}
            readOnly={!!user}
            onChange={e => setEmail(e.target.value)}
            placeholder={placeholder}
            aria-invalid={state === 'error' && !user ? true : undefined}
            className={inputClassName || NEWSLETTER_INPUT}
          />
        </label>
        <button type="submit" disabled={state === 'busy'} className={buttonClassName || NEWSLETTER_BUTTON}>
          {state === 'busy' ? 'Signing up…' : button}
        </button>
      </div>
      <p aria-live="polite" className={note ? 'mt-2 text-sm opacity-80' : 'sr-only'}>
        {note}
      </p>
    </form>
  )
}
