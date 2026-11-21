'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { SHOWCASE_SLUG_RE } from '@/lib/showcase/host'
import type { ClientSite } from '@controller/lib/showcase-builder/site'
import { businessFromForm, canSave, formFromSite, type DetailsForm } from './model'

// The builder's form with autosave: changes are saved a moment after the owner stops typing (the first save with a
// name and a free address creates the draft site), one save at a time; saveNow() flushes before moving on.

const BASE = '/api/ecom/onboard/showcase'
const DELAY_MS = 1200

export type SlugState = { state: 'idle' | 'checking' | 'ok' } | { state: 'taken'; error: string }

/** The save request for the form as it stands, or null while it can't be saved. */
function saveRequest(f: DetailsForm, cur: { site: ClientSite | null; slug: SlugState }, savedContent: DetailsForm['content']) {
  if (!canSave(f)) return null
  // A new site needs its address to be free; an existing one keeps its own until a free one is chosen.
  const slugOk = cur.slug.state === 'ok'
  if (!cur.site && !slugOk) return null
  const sendContent = f.content !== savedContent || !cur.site
  const body = JSON.stringify({ ...(slugOk ? { slug: f.slug } : {}), business: businessFromForm(f.business), ...(sendContent ? { content: f.content } : {}) })
  return { body, sendContent }
}

export async function uploadShowcaseImage(file: File, kind: 'logo' | 'service' | 'work' | 'avatar'): Promise<string> {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('kind', kind)
  const res = await fetch(`${BASE}/upload`, { method: 'POST', body: fd })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || typeof data.url !== 'string') throw new Error(data.error || 'That picture could not be uploaded.')
  return data.url
}

export function useShowcaseDetails(initialSite: ClientSite | null, ownerEmail = '') {
  const [form, setFormState] = useState<DetailsForm>(() => formFromSite(initialSite, ownerEmail))
  const [site, setSite] = useState<ClientSite | null>(initialSite)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<{ error: string; field?: string } | null>(null)
  const [dirty, setDirty] = useState(false)
  const [slug, setSlug] = useState<SlugState>({ state: initialSite ? 'ok' : 'idle' })
  const latest = useRef(form)
  latest.current = form
  const unsaved = useRef(dirty)
  unsaved.current = dirty
  const current = useRef({ site, slug })
  current.current = { site, slug }
  const running = useRef<Promise<boolean> | null>(null)
  const again = useRef(false)
  const ownSlug = site?.slug ?? null
  // The content as the server has it: a save sends the content only when the owner changed it since, so editing the
  // details never writes a stale copy over what a design run added meanwhile.
  const savedContent = useRef(form.content)

  /**
   * The site again from the server: a design run fills lists that were empty (starter services and questions, mood
   * pictures), and those come into the form, which would otherwise save its empty ones over them. Lists the owner has
   * filled stay as they are.
   */
  const refresh = useCallback(async () => {
    const data = await fetch(BASE, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null)
    const next = data?.site as ClientSite | null | undefined
    if (!next) return
    setSite(next)
    setFormState(f => {
      const c = f.content
      const theirs = next.content
      const services = !c.services.length && theirs?.services?.length ? theirs.services : c.services
      const faqs = !c.faqs.length && theirs?.faqs?.length ? theirs.faqs : c.faqs
      const pictures = !c.pictures?.length && theirs?.pictures?.length ? theirs.pictures : c.pictures
      if (services === c.services && faqs === c.faqs && pictures === c.pictures) return f
      const content = { ...c, services, faqs, pictures }
      if (c === savedContent.current) savedContent.current = content
      return { ...f, content }
    })
  }, [])

  const setForm = useCallback((next: DetailsForm | ((f: DetailsForm) => DetailsForm)) => {
    setFormState(f => (typeof next === 'function' ? next(f) : next))
    setDirty(true)
  }, [])

  const saveOnce = useCallback(async (): Promise<boolean> => {
    const f = latest.current
    const req = saveRequest(f, current.current, savedContent.current)
    if (!req) return false
    setSaving(true)
    try {
      const res = await fetch(BASE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: req.body })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSaveError({ error: data.error || 'Your changes could not be saved.', field: data.field })
        if (data.field === 'slug') setSlug({ state: 'taken', error: data.error || 'That address is taken.' })
        return false
      }
      setSite(data.site)
      setSaveError(null)
      if (req.sendContent) savedContent.current = f.content
      if (latest.current === f) setDirty(false)
      return true
    } catch {
      setSaveError({ error: 'Your changes could not be saved: check your connection.' })
      return false
    } finally {
      setSaving(false)
    }
  }, [])

  /** Saves now (a save in flight saves once more when it ends); true when the form as it stands is saved. */
  const saveNow = useCallback(async (): Promise<boolean> => {
    if (running.current) {
      again.current = true
      return running.current
    }
    const run = (async () => {
      let ok = await saveOnce()
      while (again.current) {
        again.current = false
        ok = await saveOnce()
      }
      return ok
    })()
    running.current = run
    try {
      return await run
    } finally {
      running.current = null
    }
  }, [saveOnce])

  // The address being checked holds a new site's first save back; its answer lets it go.
  useEffect(() => {
    if (!dirty) return
    const t = setTimeout(() => void saveNow(), DELAY_MS)
    return () => clearTimeout(t)
  }, [form, dirty, slug.state, saveNow])

  // The address: free, or the owner's own.
  useEffect(() => {
    const s = form.slug
    if (!s) return setSlug({ state: 'idle' })
    if (s === ownSlug) return setSlug({ state: 'ok' })
    if (!SHOWCASE_SLUG_RE.test(s)) return setSlug({ state: 'taken', error: 'Use 3–58 lowercase letters, numbers or hyphens, not starting or ending with a hyphen.' })
    setSlug({ state: 'checking' })
    let stop = false
    const t = setTimeout(async () => {
      const data = await fetch(`${BASE}/slug?${new URLSearchParams({ slug: s })}`, { cache: 'no-store' })
        .then(r => r.json())
        .catch(() => null)
      if (stop) return
      setSlug(data?.ok ? { state: 'ok' } : { state: 'taken', error: data?.error || 'That address could not be checked. Try again.' })
    }, 400)
    return () => {
      stop = true
      clearTimeout(t)
    }
  }, [form.slug, ownSlug])

  // Closing the tab before the autosave runs: the last edit goes out with the page (keepalive), with no "Leave site?"
  // prompt. Not while the first save is still creating the site, which would race it.
  useEffect(() => {
    const flush = () => {
      if (!unsaved.current || (running.current && !current.current.site)) return
      const req = saveRequest(latest.current, current.current, savedContent.current)
      if (req) fetch(BASE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: req.body, keepalive: true }).catch(() => {})
    }
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [])

  return { form, setForm, site, setSite, saving, saveError, dirty, saveNow, slug, refresh }
}

/** When a design run ends (the studio's session leaves 'building'), the form takes in what it added. */
export function useRefreshAfterBuild(status: string | undefined, refresh: () => Promise<void>) {
  const building = useRef(false)
  useEffect(() => {
    if (status === 'building') building.current = true
    else if (building.current) {
      building.current = false
      void refresh()
    }
  }, [status, refresh])
}
