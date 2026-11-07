'use client'

import { useEffect, useState } from 'react'
import CopyLinkButton from '@/components/admin/CopyLinkButton'
import { Banner, api, btnGhost, btnPrimary, inputCls } from '@/components/admin/kit/core'

// "Use your own Meta app": Social Posts and Meta Ads sign in with the store's own Meta app instead of the
// platform's. Shared by the Social credentials popup and the Meta Ads connection gear.

type AppState = {
  own: boolean
  appId?: string
  loginConfigId?: string | null
  adsLoginConfigId?: string | null
  redirectUris: string[]
  deauthorizeUrl: string
  dataDeletionUrl: string
}

const ROUTE = '/api/admin/integrations/meta-app'
const EMPTY = { appId: '', appSecret: '', loginConfigId: '', adsLoginConfigId: '' }

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs text-foreground-muted space-y-1">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="block text-[11px]">{hint}</span>}
    </label>
  )
}

export default function MetaAppCard({ own, canWrite, onChanged }: { own?: boolean; canWrite: boolean; onChanged?: () => void }) {
  const [open, setOpen] = useState(false)
  const [app, setApp] = useState<AppState | null>(null)
  const [f, setF] = useState(EMPTY)
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    if (!open || app) return
    api<AppState>(ROUTE).then(r => {
      if (!r.ok) return setMsg({ ok: false, text: r.data.error || 'Could not load the Meta app' })
      setApp(r.data)
      setF({ ...EMPTY, appId: r.data.appId ?? '', loginConfigId: r.data.loginConfigId ?? '', adsLoginConfigId: r.data.adsLoginConfigId ?? '' })
    })
  }, [open, app])

  const isOwn = app?.own ?? !!own
  const keepsSecret = isOwn && !!app?.appId && app.appId === f.appId
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setF(p => ({ ...p, [k]: e.target.value.trim() }))

  async function save() {
    setBusy('save')
    setMsg(null)
    const r = await api(ROUTE, { method: 'POST', json: f })
    setBusy(null)
    if (!r.ok) return setMsg({ ok: false, text: r.data.error || 'Could not save the Meta app' })
    setMsg({ ok: true, text: 'Meta accepted the app and it is saved. Connect with Facebook again to sign in with it.' })
    setApp(null)
    onChanged?.()
  }

  async function remove() {
    setBusy('remove')
    setMsg(null)
    const r = await api(ROUTE, { method: 'DELETE' })
    setBusy(null)
    setConfirmRemove(false)
    if (!r.ok) return setMsg({ ok: false, text: r.data.error || 'Could not remove the Meta app' })
    setMsg({ ok: true, text: 'Removed. Sign-in uses the platform app again; existing connections keep working.' })
    setApp(null)
    setF(EMPTY)
    onChanged?.()
  }

  return (
    <div className="rounded-xl border border-border-default p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">Your own Meta app</p>
          <p className="text-xs text-foreground-muted">
            {isOwn
              ? `Facebook sign-in uses your app${app?.appId ? ` (${app.appId})` : ''}.`
              : "Facebook sign-in uses the platform's app. Use your own to keep the connection under your Meta business."}
          </p>
        </div>
        <button type="button" className={btnGhost} onClick={() => setOpen(o => !o)}>
          {open ? 'Hide' : isOwn ? 'Manage' : 'Use your own Meta app'}
        </button>
      </div>

      {open && !app && !msg && <p className="text-sm text-foreground-muted">Loading...</p>}
      {open && app && (
        <div className="space-y-3">
          <ol className="list-decimal pl-4 space-y-1 text-xs text-foreground-muted">
            <li>
              At developers.facebook.com create a Business app with Facebook Login for Business (or a classic app with
              Facebook Login), and add Meta Ads (Marketing API) if you advertise.
            </li>
            <li>Add both of these as Valid OAuth Redirect URIs:</li>
          </ol>
          <div className="space-y-1.5">
            {app.redirectUris.map(u => (
              <CopyLinkButton key={u} url={u} />
            ))}
          </div>
          <p className="text-xs text-foreground-muted">Set the Deauthorize callback URL and the Data Deletion Request URL to:</p>
          <div className="space-y-1.5">
            <CopyLinkButton url={app.deauthorizeUrl} />
            <CopyLinkButton url={app.dataDeletionUrl} />
          </div>
          {canWrite ? (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="App ID">
                  <input className={inputCls} inputMode="numeric" value={f.appId} onChange={set('appId')} />
                </Field>
                <Field label="App Secret" hint={keepsSecret ? 'Saved. Leave blank to keep it.' : undefined}>
                  <input className={inputCls} type="password" autoComplete="off" value={f.appSecret} onChange={set('appSecret')} />
                </Field>
                <Field label="Social Posts login configuration ID (optional)" hint="Facebook Login for Business only.">
                  <input className={inputCls} inputMode="numeric" value={f.loginConfigId} onChange={set('loginConfigId')} />
                </Field>
                <Field label="Meta Ads login configuration ID (optional)" hint="Facebook Login for Business only.">
                  <input className={inputCls} inputMode="numeric" value={f.adsLoginConfigId} onChange={set('adsLoginConfigId')} />
                </Field>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={!!busy || !f.appId || (!f.appSecret && !keepsSecret)}
                  onClick={save}
                >
                  {busy === 'save' ? 'Checking with Meta...' : 'Verify and save'}
                </button>
                {isOwn && (
                  <button
                    type="button"
                    className={`${btnGhost} text-red-600`}
                    disabled={!!busy}
                    onBlur={() => setConfirmRemove(false)}
                    onClick={() => (confirmRemove ? remove() : setConfirmRemove(true))}
                  >
                    {busy === 'remove' ? 'Removing...' : confirmRemove ? 'Click again to remove' : 'Remove'}
                  </button>
                )}
              </div>
            </>
          ) : (
            <p className="text-xs text-foreground-muted">You don&apos;t have permission to change the Meta app.</p>
          )}
        </div>
      )}
      {msg && <Banner ok={msg.ok}>{msg.text}</Banner>}
    </div>
  )
}
