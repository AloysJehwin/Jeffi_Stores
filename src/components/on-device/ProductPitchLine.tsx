'use client'

import { useEffect, useRef, useState } from 'react'
import { canRunOnDeviceSummary, generateProductPitch } from '@/lib/on-device/runtime'
import { readUserProfile } from '@/lib/on-device/user-profile'
import { useStoreConfig } from '@/contexts/StoreConfigContext'

interface Props {
  productName: string
  brand: string | null
  category: string | null
}

type Source = 'on-device' | 'ollama'

async function fetchOllamaPitch(productName: string, brand: string | null, category: string | null): Promise<string | null> {
  const res = await fetch('/api/ai-pitch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productName, brand, category }),
  })
  if (res.status === 403) return null
  if (!res.ok) throw new Error('ollama failed')
  const data = await res.json() as { pitch?: string }
  if (!data.pitch) throw new Error('empty result')
  return data.pitch
}

export default function ProductPitchLine({ productName, brand, category }: Props) {
  const flags = useStoreConfig().flags
  const ondeviceEnabled = flags.ondeviceSummaryEnabled
  const [text, setText] = useState('')
  const [done, setDone] = useState(false)
  const [source, setSource] = useState<Source>('on-device')
  const [aiOff, setAiOff] = useState(false)
  const aiEnabled = flags.aiStorefrontEnabled && !aiOff
  const started = useRef(false)

  useEffect(() => {
    if (!ondeviceEnabled || !aiEnabled) return
    if (started.current) return
    started.current = true

    canRunOnDeviceSummary().then(async ({ capable, isMobile }) => {
      let gotText = false

      // Per-platform gate: on-device only runs where the admin enabled it for
      // this device class. Otherwise (or if the device can't run it) we fall
      // through to the server (Ollama) path below.
      const platformAllowed = isMobile ? flags.ondeviceSummaryMobileEnabled : flags.ondeviceSummaryDesktopEnabled

      if (capable && platformAllowed) {
        const profile = readUserProfile()
        try {
          setSource('on-device')
          const final = await generateProductPitch(productName, brand, category, profile, isMobile, partial => setText(partial))
          setText(final)
          setDone(true)
          gotText = true
        } catch {
          // fall through to ollama
        }
      }

      if (!gotText) {
        try {
          setSource('ollama')
          const result = await fetchOllamaPitch(productName, brand, category)
          if (result === null) { setAiOff(true); return }
          setText(result)
          setDone(true)
        } catch {
          // silently fail
        }
      }
    }).catch(() => {})
  }, [productName, brand, category, ondeviceEnabled, aiEnabled, flags.ondeviceSummaryMobileEnabled, flags.ondeviceSummaryDesktopEnabled])

  if (!aiEnabled || !text) return null

  return (
    <div className="flex items-start gap-2 mt-3 pt-3 border-t border-border-default">
      <svg className="w-3.5 h-3.5 text-accent-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
      <p className="text-sm text-foreground-secondary leading-relaxed flex-1">
        {text}{!done && <span className="animate-pulse">▍</span>}
      </p>
      <span className="text-[9px] text-foreground-muted flex-shrink-0 mt-0.5">{source}</span>
    </div>
  )
}
