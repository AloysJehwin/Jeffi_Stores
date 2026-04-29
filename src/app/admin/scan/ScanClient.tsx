'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { BrowserQRCodeReader, IScannerControls } from '@zxing/browser'

interface OrderInfo {
  id: string
  order_number: string
  status: string
  payment_status: string
  customer_name: string
}

type Stage =
  | 'idle'
  | 'scanning'
  | 'looking_up'
  | 'found'
  | 'not_found'
  | 'confirming'
  | 'updating'
  | 'done'
  | 'error'
  | 'unsupported'

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-blue-100 text-blue-800',
  processing: 'bg-blue-100 text-blue-800',
  shipped: 'bg-indigo-100 text-indigo-800',
  delivered: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
  cancel_requested: 'bg-orange-100 text-orange-800',
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ['confirmed'],
  confirmed: ['processing'],
  processing: ['shipped'],
  shipped: ['delivered'],
}

const STATUS_LABELS: Record<string, string> = {
  confirmed: 'Mark as Confirmed',
  processing: 'Mark as Processing',
  shipped: 'Mark as Shipped',
  delivered: 'Mark as Delivered',
}

function statusLabel(s: string) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export default function ScanClient() {
  const [stage, setStage] = useState<Stage>('idle')
  const [order, setOrder] = useState<OrderInfo | null>(null)
  const [selectedStatus, setSelectedStatus] = useState('')
  const [trackingUrl, setTrackingUrl] = useState('')
  const [manualInput, setManualInput] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [doneStatus, setDoneStatus] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const scanningRef = useRef(false)

  const stopCamera = useCallback(() => {
    controlsRef.current?.stop()
    controlsRef.current = null
    scanningRef.current = false
  }, [])

  useEffect(() => {
    return () => stopCamera()
  }, [stopCamera])

  useEffect(() => {
    if (stage !== 'scanning' || scanningRef.current) return
    if (!videoRef.current) return
    scanningRef.current = true

    const codeReader = new BrowserQRCodeReader()
    codeReader.decodeFromConstraints(
      { video: { facingMode: 'environment' } },
      videoRef.current,
      async (result, _err, ctrl) => {
        if (result) {
          ctrl.stop()
          controlsRef.current = null
          scanningRef.current = false
          await lookupOrder(result.getText())
        }
      }
    ).then(controls => {
      controlsRef.current = controls
    }).catch(() => {
      setErrorMsg('Camera access denied or unavailable.')
      setStage('error')
      scanningRef.current = false
    })
  }, [stage])

  async function lookupOrder(orderNumber: string) {
    setStage('looking_up')
    try {
      const res = await fetch(`/api/admin/orders/by-number?q=${encodeURIComponent(orderNumber.trim())}`)
      if (res.status === 404) {
        setStage('not_found')
        return
      }
      if (!res.ok) throw new Error('Lookup failed')
      const data = await res.json()
      setOrder(data.order)
      setStage('found')
    } catch {
      setErrorMsg('Could not look up order. Check your connection.')
      setStage('error')
    }
  }

  function startCamera() {
    setOrder(null)
    setSelectedStatus('')
    setTrackingUrl('')
    setErrorMsg('')
    setStage('scanning')
  }

  function selectStatus(s: string) {
    setSelectedStatus(s)
    setTrackingUrl('')
    setStage('confirming')
  }

  async function confirmUpdate() {
    if (!order) return
    setStage('updating')
    try {
      const body: Record<string, string> = {
        status: selectedStatus,
        payment_status: order.payment_status,
      }
      if (selectedStatus === 'shipped' && trackingUrl.trim()) {
        body.tracking_url = trackingUrl.trim()
      }
      const res = await fetch(`/api/orders/${order.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      })
      let d: any = {}
      try { d = await res.json() } catch {}
      if (!res.ok) {
        throw new Error(d.error || `Server error ${res.status}`)
      }
      setDoneStatus(selectedStatus)
      setStage('done')
    } catch (e: any) {
      setErrorMsg(e.message || 'Update failed')
      setStage('error')
    }
  }

  function reset() {
    stopCamera()
    setStage('idle')
    setOrder(null)
    setSelectedStatus('')
    setTrackingUrl('')
    setManualInput('')
    setErrorMsg('')
    setDoneStatus('')
  }

  const nextStatuses = order ? (VALID_TRANSITIONS[order.status] ?? []) : []

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {stage === 'idle' && (
        <div className="flex flex-col items-center justify-center flex-1 gap-6 p-8">
          <div className="w-20 h-20 rounded-2xl bg-secondary-500/20 flex items-center justify-center">
            <svg className="w-10 h-10 text-secondary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75v-.75zM16.5 6.75h.75v.75h-.75v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM19.5 19.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75h-.75v-.75z" />
            </svg>
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold text-white">QuickScan</h1>
            <p className="text-gray-400 mt-1 text-sm">Scan a packing slip QR code to update order status</p>
          </div>
          <button
            onClick={startCamera}
            className="w-full max-w-xs py-4 bg-secondary-500 hover:bg-secondary-600 active:bg-secondary-700 text-white font-semibold rounded-2xl text-lg transition-colors"
          >
            Start Scanning
          </button>
          <button
            onClick={() => setStage('unsupported')}
            className="text-sm text-gray-500 hover:text-gray-400 transition-colors"
          >
            Enter order number manually
          </button>
        </div>
      )}

      {stage === 'scanning' && (
        <div className="relative flex-1 bg-black overflow-hidden">
          <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-cover"
            playsInline
            muted
          />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div
              className="relative w-60 h-60 rounded-2xl"
              style={{
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
              }}
            >
              <span className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-white rounded-tl-2xl" />
              <span className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-white rounded-tr-2xl" />
              <span className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-white rounded-bl-2xl" />
              <span className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-white rounded-br-2xl" />
            </div>
            <p className="mt-6 text-white/70 text-sm">Point at the QR code on the packing slip</p>
          </div>
          <button
            onClick={reset}
            className="absolute top-4 right-4 p-2 bg-black/50 rounded-full text-white"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {stage === 'looking_up' && (
        <div className="flex flex-col items-center justify-center flex-1 gap-4 p-8">
          <div className="w-12 h-12 border-4 border-secondary-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400">Looking up order…</p>
        </div>
      )}

      {stage === 'unsupported' && (
        <div className="flex flex-col flex-1 p-6 gap-4">
          <div className="flex items-center gap-3 mb-2">
            <button onClick={reset} className="p-2 text-gray-400 hover:text-white">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h2 className="text-lg font-semibold">Enter Order Number</h2>
          </div>
          <p className="text-gray-400 text-sm">Type the order number from the packing slip.</p>
          <input
            type="text"
            placeholder="e.g. ORD-1777399568448-4VQ4RG"
            value={manualInput}
            onChange={e => setManualInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && manualInput.trim() && lookupOrder(manualInput)}
            className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-secondary-500 text-sm"
            autoFocus
          />
          <button
            onClick={() => lookupOrder(manualInput)}
            disabled={!manualInput.trim()}
            className="w-full py-3.5 bg-secondary-500 hover:bg-secondary-600 disabled:opacity-40 text-white font-semibold rounded-xl transition-colors"
          >
            Look Up
          </button>
        </div>
      )}

      {stage === 'not_found' && (
        <div className="flex flex-col items-center justify-center flex-1 gap-5 p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <div>
            <p className="text-lg font-semibold text-white">Order not found</p>
            <p className="text-gray-400 text-sm mt-1">This QR code does not match any order.</p>
          </div>
          <button onClick={reset} className="w-full max-w-xs py-3.5 bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-xl transition-colors">
            Try Again
          </button>
        </div>
      )}

      {(stage === 'found' || stage === 'confirming') && order && (
        <div className="flex flex-col flex-1 p-6 gap-5">
          <div className="flex items-center gap-3">
            <button onClick={reset} className="p-2 text-gray-400 hover:text-white">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h2 className="text-lg font-semibold">Order Found</h2>
          </div>

          <div className="bg-gray-800 rounded-2xl p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Order Number</p>
                <p className="font-mono font-semibold text-white">#{order.order_number}</p>
              </div>
              <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[order.status] || 'bg-gray-700 text-gray-300'}`}>
                {statusLabel(order.status)}
              </span>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Customer</p>
              <p className="text-white">{order.customer_name || '—'}</p>
            </div>
          </div>

          {nextStatuses.length === 0 ? (
            <div className="bg-gray-800 rounded-2xl p-4 text-center text-gray-400 text-sm">
              No further status updates available for this order.
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-gray-400">Update status to:</p>
              {nextStatuses.map(s => (
                <button
                  key={s}
                  onClick={() => selectStatus(s)}
                  className={`w-full py-4 rounded-2xl font-semibold text-white transition-colors text-base ${
                    selectedStatus === s
                      ? 'bg-secondary-500 ring-2 ring-secondary-400'
                      : 'bg-gray-700 hover:bg-gray-600 active:bg-gray-500'
                  }`}
                >
                  {STATUS_LABELS[s] || statusLabel(s)}
                </button>
              ))}
            </div>
          )}

          {stage === 'confirming' && selectedStatus === 'shipped' && (
            <div className="space-y-2">
              <label className="text-sm text-gray-400">Tracking URL <span className="text-gray-600">(optional)</span></label>
              <input
                type="url"
                placeholder="https://track.delhivery.com/..."
                value={trackingUrl}
                onChange={e => setTrackingUrl(e.target.value)}
                className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-secondary-500 text-sm"
              />
              <p className="text-xs text-gray-500">Can be added later from the full order page.</p>
            </div>
          )}

          {stage === 'confirming' && (
            <button
              onClick={confirmUpdate}
              className="w-full py-4 bg-secondary-500 hover:bg-secondary-600 active:bg-secondary-700 text-white font-bold rounded-2xl text-base transition-colors mt-auto"
            >
              Confirm — {statusLabel(selectedStatus)}
            </button>
          )}
        </div>
      )}

      {stage === 'updating' && (
        <div className="flex flex-col items-center justify-center flex-1 gap-4 p-8">
          <div className="w-12 h-12 border-4 border-secondary-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400">Updating order…</p>
        </div>
      )}

      {stage === 'done' && order && (
        <div className="flex flex-col items-center justify-center flex-1 gap-6 p-8 text-center">
          <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center">
            <svg className="w-10 h-10 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <div>
            <p className="text-2xl font-bold text-white">Done!</p>
            <p className="text-gray-300 mt-2">
              <span className="font-mono">#{order.order_number}</span>
            </p>
            <p className="text-gray-400 text-sm mt-1">
              Status updated to{' '}
              <span className="font-semibold text-green-400">{statusLabel(doneStatus)}</span>
            </p>
          </div>
          <button
            onClick={reset}
            className="w-full max-w-xs py-4 bg-secondary-500 hover:bg-secondary-600 text-white font-semibold rounded-2xl text-lg transition-colors"
          >
            Scan Next
          </button>
        </div>
      )}

      {stage === 'error' && (
        <div className="flex flex-col items-center justify-center flex-1 gap-5 p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9.303 3.376c.866 1.5-.217 3.374-1.948 3.374H4.645c-1.73 0-2.813-1.874-1.948-3.374L10.05 3.378c.866-1.5 3.032-1.5 3.898 0L21.303 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <div>
            <p className="text-lg font-semibold text-white">Something went wrong</p>
            <p className="text-gray-400 text-sm mt-1">{errorMsg}</p>
          </div>
          <button onClick={reset} className="w-full max-w-xs py-3.5 bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-xl transition-colors">
            Try Again
          </button>
        </div>
      )}
    </div>
  )
}
