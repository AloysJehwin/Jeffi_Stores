'use client'

import dynamic from 'next/dynamic'

// The bridge in a chunk of its own, fetched only where SiteEditorGate renders this (a preview token, the flag on).
const SiteEditorBridge = dynamic(() => import('./SiteEditorBridge'), { ssr: false })

export default function SiteEditorLazy() {
  return <SiteEditorBridge />
}
