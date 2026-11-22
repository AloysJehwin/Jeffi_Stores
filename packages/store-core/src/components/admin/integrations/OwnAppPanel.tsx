'use client'

import { useCallback, useEffect, useState } from 'react'
import CopyLinkButton from '@/components/admin/CopyLinkButton'
import { Banner, api, btnGhost, btnPrimary, inputCls } from '@/components/admin/kit/core'
import { useCanWrite } from '@/contexts/AdminScopesContext'

// "Your own <app>": an integration signs in with the store's own OAuth app instead of the platform's.
// Same look as MetaAppCard.

export type OwnAppFamily = 'google' | 'amazon_seller' | 'amazon_ads' | 'pinterest' | 'linkedin' | 'x'

type AppState = {
  family: OwnAppFamily
  label: string
  own: boolean
  clientId: string | null
  applicationId: string | null
  platformReady: boolean
  /** The flagship: its saved app is every store's default sign-in app. */
  isPlatform?: boolean
  redirectUris: string[]
}

const LABEL: Record<OwnAppFamily, string> = {
  google: 'Google OAuth client',
  amazon_seller: 'Amazon Selling Partner app',
  amazon_ads: 'Amazon Ads (Login with Amazon) app',
  pinterest: 'Pinterest app',
  linkedin: 'LinkedIn app',
  x: 'X app',
}

// Any one of these lets the admin change the family's app (mirrors the route).
const WRITE_SCOPES: Record<OwnAppFamily, string[]> = {
  google: ['merchant_sync:write', 'google_ads:write', 'social:write'],
  amazon_seller: ['amazon:write'],
  amazon_ads: ['amazon_ads:write'],
  pinterest: ['social:write'],
  linkedin: ['social:write'],
  x: ['social:write'],
}

const HELP: Record<OwnAppFamily, string[]> = {
  google: [
    'In Google Cloud, open APIs & Services, Credentials and create an OAuth client (Web application). Enable the APIs you use (Content API / Merchant API, Google Ads API, Business Profile, YouTube Data API).',
  ],
  amazon_seller: [
    'In Seller Central, open Develop apps and create an SP-API app. Copy its LWA client ID and secret, and the app ID (amzn1.sp.solution…).',
  ],
  amazon_ads: [
    'In the Amazon developer console, create a Login with Amazon security profile that is approved for the Amazon Ads API.',
  ],
  pinterest: ['At developers.pinterest.com, create an app with the boards and pins scopes.'],
  linkedin: ['At linkedin.com/developers, create an app for your company page and add the Community Management API.'],
  x: ['At developer.x.com, create a project app and turn on OAuth 2.0 as a Web App.'],
}

const EMPTY = { clientId: '', clientSecret: '', applicationId: '' }
const WRITE_HEADERS = { 'x-requested-with': 'jeffi-admin' }

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs text-foreground-muted space-y-1">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="block text-[11px]">{hint}</span>}
    </label>
  )
}

export default function OwnAppPanel({
  family,
  title,
  help,
  onChange,
}: {
  family: OwnAppFamily
  title?: string
  help?: string[]
  onChange?: () => void
}) {
  const scopes = WRITE_SCOPES[family]
  const w0 = useCanWrite(scopes[0])
  const w1 = useCanWrite(scopes[1] ?? scopes[0])
  const w2 = useCanWrite(scopes[2] ?? scopes[0])
  const canWrite = w0 || w1 || w2
  const route = `/api/admin/integrations/oauth-app/${family}`

  const [open, setOpen] = useState(false)
  const [app, setApp] = useState<AppState | null>(null)
  const [hidden, setHidden] = useState(false)
  const [f, setF] = useState(EMPTY)
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    const r = await api<AppState>(route).catch(() => null)
    if (!r?.data) return setMsg({ ok: false, text: 'Could not load the app settings' })
    if (r.ok) {
      setApp(r.data)
      setF({ clientId: r.data.clientId ?? '', clientSecret: '', applicationId: r.data.applicationId ?? '' })
    } else if (r.data && (r.data as any).error === 'Insufficient permissions') setHidden(true)
    else setMsg({ ok: false, text: r.data.error || 'Could not load the app settings' })
  }, [route])

  useEffect(() => {
    load()
  }, [load])

  if (hidden) return null

  const label = app?.label ?? LABEL[family]
  const heading = title ?? `Your own ${label}`
  const isOwn = !!app?.own
  const keepsSecret = isOwn && !!app?.clientId && app.clientId === f.clientId
  const needsAppId = family === 'amazon_seller'
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setF(p => ({ ...p, [k]: e.target.value.trim() }))

  async function save() {
    setBusy('save')
    setMsg(null)
    const json: Record<string, string> = { clientId: f.clientId, clientSecret: f.clientSecret }
    if (needsAppId) json.applicationId = f.applicationId
    const r = await api(route, { method: 'POST', json, headers: WRITE_HEADERS })
    setBusy(null)
    if (!r.ok) return setMsg({ ok: false, text: r.data.error || 'Could not save the app' })
    setMsg({ ok: true, text: 'Saved. Connect again to sign in with your app.' })
    await load()
    onChange?.()
  }

  async function remove() {
    setBusy('remove')
    setMsg(null)
    const r = await api(route, { method: 'DELETE', headers: WRITE_HEADERS })
    setBusy(null)
    setConfirmRemove(false)
    if (!r.ok) return setMsg({ ok: false, text: r.data.error || 'Could not remove the app' })
    setMsg({
      ok: true,
      text: app?.platformReady
        ? 'Removed. Sign-in uses the platform app again; existing connections keep working.'
        : 'Removed. Existing connections keep working until they are reconnected.',
    })
    await load()
    onChange?.()
  }

  const status = !app
    ? 'Loading...'
    : isOwn
      ? `Sign-in uses your app${app.clientId ? ` (${app.clientId})` : ''}${app.isPlatform ? ', and every store without its own app signs in with it too' : ''}.`
      : app.isPlatform
        ? 'Save the app here; every store without its own app signs in with it.'
        : app.platformReady
        ? "Sign-in uses the platform's app. Use your own to keep the connection under your account."
        : "The platform app isn't set up here, so add your own app to connect."

  return (
    <div className="rounded-xl border border-border-default p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{heading}</p>
          <p className="text-xs text-foreground-muted [overflow-wrap:anywhere]">{status}</p>
        </div>
        <button type="button" className={btnGhost} disabled={!app} onClick={() => setOpen(o => !o)}>
          {open ? 'Hide' : isOwn ? 'Manage' : 'Use your own'}
        </button>
      </div>

      {open && app && (
        <div className="space-y-3">
          <ol className="list-decimal pl-4 space-y-1 text-xs text-foreground-muted">
            {(help ?? HELP[family]).map(h => (
              <li key={h}>{h}</li>
            ))}
            <li>{app.redirectUris.length > 1 ? 'Add all of these as redirect URIs:' : 'Add this as the redirect URI:'}</li>
          </ol>
          <div className="space-y-1.5">
            {app.redirectUris.map(u => (
              <CopyLinkButton key={u} url={u} />
            ))}
          </div>
          {canWrite ? (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Client ID">
                  <input className={inputCls} autoComplete="off" value={f.clientId} onChange={set('clientId')} />
                </Field>
                <Field label="Client Secret">
                  <input
                    className={inputCls}
                    type="password"
                    autoComplete="off"
                    placeholder={isOwn ? 'Leave blank to keep the saved secret' : undefined}
                    value={f.clientSecret}
                    onChange={set('clientSecret')}
                  />
                </Field>
                {needsAppId && (
                  <Field label="Application ID" hint="Seller Central, Develop apps.">
                    <input
                      className={inputCls}
                      autoComplete="off"
                      placeholder="amzn1.sp.solution…"
                      value={f.applicationId}
                      onChange={set('applicationId')}
                    />
                  </Field>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={!!busy || !f.clientId || (!f.clientSecret && !keepsSecret) || (needsAppId && !f.applicationId)}
                  onClick={save}
                >
                  {busy === 'save' ? 'Saving...' : 'Save'}
                </button>
                {isOwn && (
                  <button
                    type="button"
                    className={`${btnGhost} text-red-600`}
                    disabled={!!busy}
                    onBlur={() => setConfirmRemove(false)}
                    onClick={() => (confirmRemove ? remove() : setConfirmRemove(true))}
                  >
                    {busy === 'remove'
                      ? 'Removing...'
                      : confirmRemove
                        ? 'Click again to confirm'
                        : app.platformReady
                          ? 'Use platform app'
                          : 'Remove'}
                  </button>
                )}
              </div>
            </>
          ) : (
            <p className="text-xs text-foreground-muted">You don&apos;t have permission to change this app.</p>
          )}
        </div>
      )}
      {msg && <Banner ok={msg.ok}>{msg.text}</Banner>}
    </div>
  )
}
