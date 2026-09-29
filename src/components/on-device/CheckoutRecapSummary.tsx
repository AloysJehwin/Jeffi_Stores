'use client'

import { useEffect, useRef, useState } from 'react'
import { ThumbsUp, ThumbsDown } from 'lucide-react'
import { canRunOnDeviceSummary, generateRecap, disposeSummarizer } from '@/lib/on-device/runtime'
import { useStoreConfig } from '@/contexts/StoreConfigContext'
import { getViewedProducts, getSearches } from '@/lib/on-device/session-signals'
import { readUserProfile } from '@/lib/on-device/user-profile'
import type { SessionSignals, CartLine } from '@/lib/on-device/prompt'

const FEEDBACK_KEY = 'jeffi_od_feedback'
const WIFI_DISMISSED_KEY = 'jeffi_od_wifi_dismissed'
const MOBILE_TOAST_KEY = 'jeffi_od_mobile_shown'

function readFeedbackStyle(): 'concise' | 'detailed' | null {
  try {
    const raw = localStorage.getItem(FEEDBACK_KEY)
    if (!raw) return null
    const entries: { v: 'liked' | 'disliked'; style: string }[] = JSON.parse(raw)
    const liked = entries.filter(e => e.v === 'liked').length
    const disliked = entries.filter(e => e.v === 'disliked').length
    if (liked > disliked * 2) return 'detailed'
    if (disliked > liked) return 'concise'
    return null
  } catch { return null }
}

function saveFeedback(vote: 'liked' | 'disliked', text: string) {
  try {
    const raw = localStorage.getItem(FEEDBACK_KEY)
    const entries = raw ? JSON.parse(raw) : []
    entries.push({ v: vote, style: text.length > 100 ? 'detailed' : 'concise', ts: Date.now() })
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify(entries.slice(-20)))
  } catch {}
}

export default function CheckoutRecapSummary({ items, total }: { items: CartLine[]; total: number }) {
  const flags = useStoreConfig().flags
  const ondeviceEnabled = flags.ondeviceSummaryEnabled
  const [verdict, setVerdict] = useState<{ capable: boolean; reason: string; isMobile: boolean } | null>(null)
  const [text, setText] = useState('')
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [source, setSource] = useState<'on-device' | 'ollama'>('on-device')
  const [feedback, setFeedback] = useState<'liked' | 'disliked' | null>(null)
  const [wifiDismissed, setWifiDismissed] = useState(false)
  const [showMobileToast, setShowMobileToast] = useState(false)
  const [aiOff, setAiOff] = useState(false)
  const aiEnabled = flags.aiStorefrontEnabled && !aiOff
  const started = useRef(false)

  // Whether the in-browser model is allowed to run on THIS device class.
  const platformAllowed = verdict
    ? (verdict.isMobile ? flags.ondeviceSummaryMobileEnabled : flags.ondeviceSummaryDesktopEnabled)
    : false
  const onDeviceRuns = !!verdict?.capable && platformAllowed

  useEffect(() => {
    if (!ondeviceEnabled || !aiEnabled) return
    let alive = true
    canRunOnDeviceSummary().then(v => {
      if (!alive) return
      setVerdict(v)
      // Check dismissal state
      try {
        if (sessionStorage.getItem(WIFI_DISMISSED_KEY)) setWifiDismissed(true)
      } catch {}
      // Show mobile explainer once — only when on-device actually runs on mobile
      // (not when the phone is using the server fallback).
      const mobileOnDevice = v.capable && v.isMobile && flags.ondeviceSummaryMobileEnabled
      if (mobileOnDevice) {
        try {
          if (!localStorage.getItem(MOBILE_TOAST_KEY)) {
            setShowMobileToast(true)
            localStorage.setItem(MOBILE_TOAST_KEY, '1')
          }
        } catch {}
      }
    })
    return () => { alive = false; disposeSummarizer() }
  }, [ondeviceEnabled, aiEnabled, flags.ondeviceSummaryMobileEnabled])

  useEffect(() => {
    if (!aiEnabled || !verdict || started.current) return
    if (!items || items.length === 0) return
    // If on-device won't run here AND there's no server fallback path (feature
    // disabled entirely is already handled by the ondeviceEnabled guard above),
    // we still fall back to the server. Only bail when the feature is off.
    started.current = true

    const profile = readUserProfile()
    const recapStyle = readFeedbackStyle()
    const itemCount = items.reduce((s, c) => s + c.qty, 0)
    const signals: SessionSignals = {
      cart: items,
      total: Math.round((total || 0) * 100) / 100,
      itemCount,
      viewed: getViewedProducts(),
      searches: getSearches(),
      userProfile: profile.purchaseCount > 0 ? profile : null,
      recapStyle,
    }

    setState('loading')

    const runServerFallback = async () => {
      try {
        setSource('ollama')
        const res = await fetch('/api/ai-recap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cart: items, total: signals.total, itemCount }),
        })
        if (res.status === 403) { setAiOff(true); return }
        if (!res.ok) throw new Error('ollama failed')
        const data = await res.json() as { text?: string }
        if (!data.text) throw new Error('empty')
        setText(data.text); setState('done')
      } catch {
        setState('error')
      }
    }

    if (onDeviceRuns) {
      setSource('on-device')
      generateRecap(signals, verdict.isMobile, (partial) => setText(partial))
        .then(final => { setText(final); setState('done') })
        .catch(() => { runServerFallback() })
    } else {
      // Device can't (or isn't allowed to) run on-device → server fallback.
      runServerFallback()
    }
  }, [aiEnabled, verdict, items, total, onDeviceRuns])

  if (!aiEnabled) return null

  // Not-wifi banner — only relevant when on-device WOULD run on this device
  // (platform-allowed). If the device uses the server fallback, wifi is irrelevant.
  if (verdict?.reason === 'not-wifi' && platformAllowed && !wifiDismissed) {
    return (
      <div className="rounded-xl border border-border-default bg-surface-elevated px-4 py-3 mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-foreground-muted flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
          </svg>
          <p className="text-xs text-foreground-secondary">Connect to Wi-Fi to enable on-device AI summary</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setWifiDismissed(true)
            try { sessionStorage.setItem(WIFI_DISMISSED_KEY, '1') } catch {}
          }}
          className="text-foreground-muted hover:text-foreground transition-colors flex-shrink-0"
          aria-label="Dismiss"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    )
  }

  if (state === 'error') return null
  if (state === 'idle') return null
  // Don't render the panel until real text has started streaming. This prevents a
  // visible box (and any "loading" text) from flashing when generation fails and
  // the component then unmounts — matching the sibling panels. (No capability
  // guard here: incapable devices still render via the server/Ollama fallback.)
  if (!text.trim()) return null

  return (
    <>
      {/* Mobile explainer toast */}
      {showMobileToast && (
        <div className="rounded-lg border border-accent-200 dark:border-accent-700 bg-accent-50 dark:bg-accent-900/20 px-3 py-2 mb-3 flex items-center justify-between gap-2">
          <p className="text-xs text-accent-700 dark:text-accent-300">This summary runs on your device&apos;s AI chip — no data leaves your phone</p>
          <button type="button" onClick={() => setShowMobileToast(false)} className="text-accent-400 hover:text-accent-600 flex-shrink-0">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      <div className="rounded-xl border border-border-default bg-surface-elevated p-4 mb-4">
        <div className="flex items-center gap-2 mb-1.5">
          <svg className="w-4 h-4 text-accent-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Your order at a glance</span>
          <span className="text-[9px] text-foreground-muted ml-auto">{source === 'on-device' ? 'on-device · private' : 'AI summary'}</span>
        </div>

        <p className="text-sm text-foreground leading-relaxed">
          {text}{state === 'loading' && <span className="animate-pulse">▍</span>}
        </p>

        {/* 👍/👎 feedback — only shown after completion */}
        {state === 'done' && text && !feedback && (
          <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border-default">
            <span className="text-[10px] text-foreground-muted">Helpful?</span>
            <button
              type="button"
              onClick={() => { setFeedback('liked'); saveFeedback('liked', text) }}
              className="text-foreground-muted hover:text-accent-500 transition-colors"
              aria-label="Liked"
            >
              <ThumbsUp className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => { setFeedback('disliked'); saveFeedback('disliked', text) }}
              className="text-foreground-muted hover:text-red-500 transition-colors"
              aria-label="Disliked"
            >
              <ThumbsDown className="w-4 h-4" />
            </button>
          </div>
        )}
        {feedback && (
          <p className="text-[10px] text-foreground-muted mt-2 pt-2 border-t border-border-default">
            {feedback === 'liked' ? "Thanks! We'll keep this style." : "Got it — we'll adjust next time."}
          </p>
        )}
      </div>
    </>
  )
}
