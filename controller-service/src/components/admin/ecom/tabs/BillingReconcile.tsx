'use client'

import { useState } from 'react'
import { useActionToast } from '@/components/admin/kit/toast'

type ReconcileRow = { awb: string; billedAmount: number }

// Delhivery's billing export is a plain CSV. Find the AWB column and the final-charge column by
// header name (the panel labels vary), then pull those two per row. Anything unparseable is dropped.
function parseBillingCsv(text: string): ReconcileRow[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '')
  if (lines.length < 2) return []
  const split = (line: string) => line.split(',').map(c => c.trim().replace(/^"|"$/g, ''))
  const header = split(lines[0]).map(h => h.toLowerCase())
  const awbCol = header.findIndex(h => h.includes('waybill') || h.includes('awb'))
  const amtCol = header.findIndex(
    h => h.includes('total') || h.includes('charged amount') || h.includes('amount') || h.includes('billed')
  )
  if (awbCol < 0 || amtCol < 0) return []
  const rows: ReconcileRow[] = []
  for (const line of lines.slice(1)) {
    const cells = split(line)
    const awb = (cells[awbCol] || '').trim()
    const billedAmount = Number((cells[amtCol] || '').replace(/[^0-9.\-]/g, ''))
    if (awb && Number.isFinite(billedAmount) && billedAmount >= 0) rows.push({ awb, billedAmount })
  }
  return rows
}

// Platform-admin true-up of a tenant wallet against the platform Delhivery account's billing CSV.
export default function BillingReconcile({ tenantId }: { tenantId: string }) {
  const [period, setPeriod] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useActionToast()
  const setMsg = (r: { ok: boolean; text: string } | null) => r && toast.result(r)
  const [summary, setSummary] = useState<Record<string, number> | null>(null)

  const reconcile = async (file: File) => {
    setBusy(true)
    setMsg(null)
    setSummary(null)
    try {
      const rows = parseBillingCsv(await file.text())
      if (rows.length === 0) {
        setMsg({ ok: false, text: 'No AWB / charge rows found. Check the CSV has waybill and amount columns.' })
        return
      }
      const res = await fetch(`/api/admin/ecom/${tenantId}/wallet/reconcile-billing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period: period.trim(), rows }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMsg({ ok: false, text: data.error || 'Reconciliation failed' })
        return
      }
      setSummary(data.summary || {})
      setMsg({ ok: true, text: `Reconciled ${rows.length} row${rows.length !== 1 ? 's' : ''} for ${data.period}.` })
    } catch {
      setMsg({ ok: false, text: 'Could not read or upload the CSV.' })
    } finally {
      setBusy(false)
    }
  }

  const ready = /^\d{4}-\d{2}$/.test(period.trim())

  return (
    <div className="space-y-3">
      <p className="text-xs text-foreground-muted">
        Upload the platform Delhivery billing CSV for a month. Each of this tenant&apos;s AWBs is netted to the billed
        amount (weight disputes, RTO, COD fee). AWBs not found in this tenant&apos;s wallet are reported as unmatched,
        never debited. Re-uploading the same period is safe.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={period}
          onChange={e => setPeriod(e.target.value)}
          type="text"
          placeholder="Billing period e.g. 2026-08"
          className="w-48 text-sm rounded-lg border border-border-default bg-surface-elevated px-3 h-control text-foreground"
        />
        <label
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
            busy || !ready
              ? 'bg-surface-secondary text-foreground-muted pointer-events-none opacity-50'
              : 'bg-accent-600 hover:bg-accent-700 text-white'
          }`}
        >
          {busy ? 'Reconciling…' : 'Upload billing CSV'}
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            disabled={busy || !ready}
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) reconcile(f)
              e.target.value = ''
            }}
          />
        </label>
      </div>
      {summary && (
        <div className="flex flex-wrap gap-3 text-xs text-foreground-secondary">
          {Object.entries(summary).map(([k, v]) => (
            <span key={k} className="capitalize">
              <span className="font-medium text-foreground">{v}</span> {k}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
