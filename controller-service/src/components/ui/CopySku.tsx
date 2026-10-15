'use client'

import { useState } from 'react'

// Compact inline "copy SKU" button. Sits next to a displayed SKU value anywhere in
// the app (tables, cards, modals, labels). Renders nothing when there's no sku.
// Stops click propagation so it can live inside clickable rows/cards without
// triggering their navigation.
export default function CopySku({ sku, className = '' }: { sku?: string | null; className?: string }) {
  const [copied, setCopied] = useState(false)
  if (!sku) return null

  async function handleCopy(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(String(sku))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — silently ignore.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? 'Copied!' : `Copy SKU ${sku}`}
      aria-label={`Copy SKU ${sku}`}
      className={`inline-flex shrink-0 align-middle text-foreground-muted hover:text-accent-600 transition-colors ${className}`}
    >
      {copied ? (
        <svg
          className="w-3.5 h-3.5 text-green-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
          />
        </svg>
      )}
    </button>
  )
}
