'use client'

import { useEffect, useRef, useState } from 'react'
import { canRunOnDeviceSummary, generateRecap, disposeSummarizer } from '@/lib/on-device/runtime'
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
  const [verdict, setVerdict] = useState<{ capable: boolean; reason: string; isMobile: boolean } | null>(null)
  const [text, setText] = useState('')
  const [errMsg, setErrMsg] = useState('')
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [feedback, setFeedback] = useState<'liked' | 'disliked' | null>(null)
  const [wifiDismissed, setWifiDismissed] = useState(false)
  const [showMobileToast, setShowMobileToast] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    let alive = true
    canRunOnDeviceSummary().then(v => {
      if (!alive) return
      setVerdict(v)
      // Check dismissal state
      try {
        if (sessionStorage.getItem(WIFI_DISMISSED_KEY)) setWifiDismissed(true)
      } catch {}
      // Show mobile explainer once
      if (v.capable && v.isMobile) {
        try {
          if (!localStorage.getItem(MOBILE_TOAST_KEY)) {
            setShowMobileToast(true)
            localStorage.setItem(MOBILE_TOAST_KEY, '1')
          }
        } catch {}
      }
    })
    return () => { alive = false; disposeSummarizer() }
  }, [])

  useEffect(() => {
    if (!verdict?.capable || started.current) return
    if (!items || items.length === 0) return
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
    generateRecap(signals, verdict.isMobile, (partial) => setText(partial))
      .then(final => { setText(final); setState('done') })
      .catch((e) => { setErrMsg(e?.message || String(e)); setState('error') })
  }, [verdict, items, total])

  // Not-wifi banner
  if (verdict?.reason === 'not-wifi' && !wifiDismissed) {
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

  if (!verdict?.capable) return null
  if (state === 'error' && process.env.NODE_ENV === 'production') return null
  if (state === 'idle') return null
  if (state === 'done' && !text.trim()) return null

  return (
    <>
      {/* Mobile explainer toast */}
      {showMobileToast && (
        <div className="rounded-lg border border-accent-200 dark:border-accent-700 bg-accent-50 dark:bg-accent-900/20 px-3 py-2 mb-3 flex items-center justify-between gap-2">
          <p className="text-xs text-accent-700 dark:text-accent-300">This summary runs on your device's AI chip — no data leaves your phone</p>
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
          <span className="text-[9px] text-foreground-muted ml-auto">on-device · private</span>
        </div>

        {state === 'loading' && !text && (
          <p className="text-sm text-foreground-muted animate-pulse">
            {verdict.isMobile ? 'Downloading AI model (~200MB)…' : 'Preparing your summary…'}
          </p>
        )}
        {state === 'error' && (
          <p className="text-xs text-red-600 break-words font-mono">[dev] {errMsg || 'unknown error'}</p>
        )}
        {(text || state === 'loading') && state !== 'error' && (
          <p className="text-sm text-foreground leading-relaxed">
            {text}{state === 'loading' && <span className="animate-pulse">▍</span>}
          </p>
        )}

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
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.633 10.25c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 0 1 2.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 0 0 .322-1.672V2.75a.75.75 0 0 1 .75-.75 2.25 2.25 0 0 1 2.25 2.25c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282m0 0h3.126c1.026 0 1.945.694 2.054 1.715.045.422.068.85.068 1.285a11.95 11.95 0 0 1-2.649 7.521c-.388.482-.987.729-1.605.729H13.48c-.483 0-.964-.078-1.423-.23l-3.114-1.04a4.501 4.501 0 0 0-1.423-.23H5.904m10.598-9.75H14.25M5.904 18.5c.083.205.173.405.27.602.197.4-.078.898-.523.898h-.908c-.889 0-1.713-.518-1.972-1.368a12 12 0 0 1-.521-3.507c0-1.553.295-3.036.831-4.398C3.387 9.953 4.167 9.5 5 9.5h1.053c.472 0 .745.556.5.96a8.958 8.958 0 0 0-1.302 4.665c0 1.194.232 2.333.654 3.375Z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => { setFeedback('disliked'); saveFeedback('disliked', text) }}
              className="text-foreground-muted hover:text-red-500 transition-colors"
              aria-label="Disliked"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.367 13.75c-.806 0-1.533.446-2.031 1.08a9.041 9.041 0 0 1-2.861 2.4c-.723.384-1.35.956-1.653 1.715a4.499 4.499 0 0 0-.322 1.672v.25a.75.75 0 0 1-.75.75 2.25 2.25 0 0 1-2.25-2.25c0-1.152.26-2.243.723-3.218.266-.558-.107-1.282-.725-1.282H4.372c-1.026 0-1.945-.694-2.054-1.715A12.137 12.137 0 0 1 2.25 12c0-2.848.992-5.464 2.649-7.521.388-.482.987-.729 1.605-.729h4.334c.483 0 .964.078 1.423.23l3.114 1.04a4.501 4.501 0 0 0 1.423.23h1.294M17.367 13.75H19.5M6.902 5.5c-.083-.205-.173-.405-.27-.602-.197-.4.078-.898.523-.898h.908c.889 0 1.713.518 1.972 1.368.16.53.27 1.175.346 1.768" />
              </svg>
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
