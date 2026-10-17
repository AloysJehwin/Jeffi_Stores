'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useActionToast } from '@/components/admin/kit/toast'
import { useCanWrite } from '@/contexts/AdminScopesContext'

// Campaign management (google_ads_campaigns:write, Pro and up) for the console tabs. Without the
// scope the context says canManage: false and every control stays hidden.

export interface ActionBody {
  action: string
  [k: string]: unknown
}

export interface AdsManage {
  canManage: boolean
  currency: string
  /** POST one edit; true when Google accepted it. Shows the result as a notice. */
  run: (body: ActionBody, key: string) => Promise<boolean>
  busyKey: string | null
  notify: (ok: boolean, text: string) => void
  reload: () => void
}

const Ctx = createContext<AdsManage | null>(null)

export function useAdsManage(): AdsManage | null {
  const ctx = useContext(Ctx)
  return ctx?.canManage ? ctx : null
}

export async function postJson(url: string, body: unknown): Promise<{ ok: boolean; data: any }> {
  const r = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { ok: r.ok, data: await r.json().catch(() => ({})) }
}

/** Google's problems, joined for a notice. */
export function errorText(data: any, fallback = 'Google Ads rejected the change'): string {
  const extra = (data?.problems ?? [])
    .slice(1, 4)
    .map((p: any) => (p.where ? `${p.where}: ${p.message}` : p.message))
    .filter(Boolean)
  return [data?.error || fallback, ...extra].join(' · ')
}

export function AdsManageProvider({ currency, onChanged, children }: { currency: string; onChanged: () => void; children: ReactNode }) {
  const canManage = useCanWrite('google_ads_campaigns')
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const toast = useActionToast()
  const setNotice = useCallback((n: { ok: boolean; text: string }) => toast.result(n), [toast])
  const notify = useCallback((ok: boolean, text: string) => setNotice({ ok, text }), [setNotice])

  const run = useCallback(
    async (body: ActionBody, key: string) => {
      setBusyKey(key)
      try {
        const { ok, data } = await postJson('/api/admin/google-ads/manage', body)
        if (!ok) {
          setNotice({ ok: false, text: errorText(data) })
          return false
        }
        setNotice({ ok: true, text: data.refreshError ? `${data.summary}. The table refreshes on the next sync.` : `${data.summary}.` })
        onChanged()
        return true
      } catch (e: any) {
        setNotice({ ok: false, text: e?.message || 'Request failed' })
        return false
      } finally {
        setBusyKey(null)
      }
    },
    [onChanged, setNotice]
  )

  const value = useMemo<AdsManage>(
    () => ({ canManage, currency, run, busyKey, notify, reload: onChanged }),
    [canManage, currency, run, busyKey, notify, onChanged]
  )

  return (
    <Ctx.Provider value={value}>
      {children}
    </Ctx.Provider>
  )
}
