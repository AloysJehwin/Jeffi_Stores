'use client'

import { useEffect, useRef, useState } from 'react'

interface Props {
  onResult: (text: string) => void
  onClose: () => void
}

// Scans an invoice / order QR or barcode with the device camera and hands back the decoded text
// (an order number), which the form uses as the customer search. Camera-only, no image upload.
export default function StaffQrScanner({ onResult, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let stop: (() => void) | null = null
    let cancelled = false
    ;(async () => {
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        const reader = new BrowserMultiFormatReader()
        if (!videoRef.current || cancelled) return
        const controls = await reader.decodeFromVideoDevice(undefined, videoRef.current, (result) => {
          if (result) {
            const text = result.getText()
            controls.stop()
            onResult(text)
          }
        })
        stop = () => controls.stop()
      } catch {
        if (!cancelled) setError('Camera is unavailable or permission was denied.')
      }
    })()
    return () => { cancelled = true; stop?.() }
  }, [onResult])

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <p className="text-sm font-medium">Scan order QR / barcode</p>
        <button type="button" onClick={onClose} className="text-sm px-3 py-1.5 rounded-lg bg-white/15">Close</button>
      </div>
      <video ref={videoRef} className="flex-1 w-full object-cover" muted playsInline />
      {error && <p className="text-center text-sm text-red-300 py-3">{error}</p>}
    </div>
  )
}
