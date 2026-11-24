'use client'

import { useEffect } from 'react'
import { classifyLink } from '@showcase/lib/links'
import { SHOWCASE_PREVIEW_PARAM } from '@/lib/showcase/host'

// The Showcase's visit tracker, as the storefront's PageTracker: a per-tab session id in sessionStorage, no cookies,
// beacons to /api/track. A page view on load; how far the visitor scrolled and how long the page was visible on the way
// out (and every 30 s while it changes); taps on contact, map, social and outbound links; and the contact form's first
// focus and submit. Nothing for automated browsers, nor for the owner's own look at their site: the console opens it
// with ?jeffi_preview=1, which marks the tab (and is taken off the address).

const ENDPOINT = '/api/track'
const SID = 'jsc_sid'
const ENGAGED = 'jsc_en'
const PREVIEW = 'jsc_preview'

/** Opened from the console in this tab: not a visit. */
function ownerPreview(): boolean {
  try {
    const url = new URL(location.href)
    if (url.searchParams.has(SHOWCASE_PREVIEW_PARAM)) {
      sessionStorage.setItem(PREVIEW, '1')
      url.searchParams.delete(SHOWCASE_PREVIEW_PARAM)
      history.replaceState(history.state, '', url.pathname + url.search + url.hash)
      return true
    }
    return sessionStorage.getItem(PREVIEW) === '1'
  } catch {
    return false
  }
}
// Once per page load: a dev re-run of the effect (Strict Mode) adds its listeners again, not a second page view.
let viewed = false

function sessionId(): string {
  const make = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`)
  try {
    let s = sessionStorage.getItem(SID)
    if (!s) {
      s = make()
      sessionStorage.setItem(SID, s)
    }
    return s
  } catch {
    return make()
  }
}

function send(body: Record<string, unknown>) {
  const json = JSON.stringify(body)
  try {
    if (navigator.sendBeacon?.(ENDPOINT, json)) return
  } catch {}
  fetch(ENDPOINT, { method: 'POST', body: json, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(() => {})
}

export default function Tracker() {
  useEffect(() => {
    if (navigator.webdriver || ownerPreview()) return
    const s = sessionId()
    let engaged = 0
    try {
      engaged = Number(sessionStorage.getItem(ENGAGED)) || 0
    } catch {}
    let visibleSince = document.visibilityState === 'visible' ? Date.now() : 0
    let maxScroll = 0
    let sent = { sc: -1, en: -1 }
    let formStarted = false

    const engagedNow = () => engaged + (visibleSince ? Date.now() - visibleSince : 0)
    const state = () => ({ sc: maxScroll, en: engagedNow() })
    const measure = () => {
      const doc = document.documentElement
      const h = Math.max(doc.scrollHeight, document.body?.scrollHeight ?? 0)
      const pct = h > 0 ? Math.round(((window.scrollY + window.innerHeight) / h) * 100) : 100
      if (pct > maxScroll) maxScroll = Math.min(100, pct)
    }
    const ping = () => {
      const st = state()
      if (st.sc === sent.sc && Math.abs(st.en - sent.en) < 1000) return
      sent = st
      send({ s, t: 'ping', p: location.pathname, ...st })
    }

    const conn = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection
    measure()
    if (!viewed) {
      viewed = true
      send({
        s,
        t: 'pageview',
        p: location.pathname,
        q: location.search,
        r: document.referrer,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        lang: navigator.language,
        sw: screen.width,
        sh: screen.height,
        vw: window.innerWidth,
        net: conn?.effectiveType,
      })
    }

    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        measure()
      })
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') visibleSince = Date.now()
      else {
        if (visibleSince) engaged += Date.now() - visibleSince
        visibleSince = 0
        try {
          sessionStorage.setItem(ENGAGED, String(engaged))
        } catch {}
        ping()
      }
    }
    const onHide = () => {
      try {
        sessionStorage.setItem(ENGAGED, String(engagedNow()))
      } catch {}
      ping()
    }
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a) return
      const href = a.getAttribute('href') ?? ''
      if (!classifyLink(a.href || href, location.host)) return
      send({ s, t: 'click', p: location.pathname, h: (a.href || href).slice(0, 2000), ...state() })
    }
    const onFocus = (e: FocusEvent) => {
      const el = e.target as HTMLInputElement | null
      if (formStarted || !el?.form || el.name === 'website' || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return
      formStarted = true
      send({ s, t: 'form_start', p: location.pathname, ...state() })
    }
    const onSubmit = () => send({ s, t: 'form_submit', p: location.pathname, ...state() })

    const timer = setInterval(() => document.visibilityState === 'visible' && ping(), 30_000)
    window.addEventListener('scroll', onScroll, { passive: true })
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onHide)
    document.addEventListener('click', onClick, true)
    document.addEventListener('focusin', onFocus)
    document.addEventListener('submit', onSubmit, true)
    return () => {
      clearInterval(timer)
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('submit', onSubmit, true)
    }
  }, [])
  return null
}
