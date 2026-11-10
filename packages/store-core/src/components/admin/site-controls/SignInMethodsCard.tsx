'use client'

import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import Toggle from '@/components/ui/Toggle'
import { Badge, CopyValue, btnGhost, btnPrimary, inputCls } from '@/components/admin/kit'
import { SocialIcon } from '@/components/auth/SocialIcons'
import { SOCIAL_LABEL, type SocialProvider } from '@/lib/auth/social/types'
import type { SignInMethodAdminView } from '@/lib/auth/social/config'

type Field = 'clientId' | 'clientSecret' | 'teamId' | 'keyId' | 'privateKey'

interface ProviderCopy {
  blurb: string
  consoleUrl: string
  consoleLabel: string
  steps: string
  fields: Array<{ key: Field; label: string; placeholder?: string; secret?: boolean; multiline?: boolean }>
}

const COPY: Record<SocialProvider, ProviderCopy> = {
  google: {
    blurb: 'On by default. Add your own Google client so the consent screen shows your store name and logo.',
    consoleUrl: 'https://console.cloud.google.com/apis/credentials',
    consoleLabel: 'Google Cloud Console',
    steps: 'Create an OAuth client ID of type Web application, set your name and logo on the consent screen, and add the redirect URIs below.',
    fields: [
      { key: 'clientId', label: 'Client ID', placeholder: '1234567890-abc.apps.googleusercontent.com' },
      { key: 'clientSecret', label: 'Client secret', secret: true },
    ],
  },
  facebook: {
    blurb: 'Let customers sign in with their Facebook account through your own Meta app.',
    consoleUrl: 'https://developers.facebook.com/apps',
    consoleLabel: 'Meta for Developers',
    steps: 'Create an app, add the Facebook Login product, and paste the redirect URIs below under Valid OAuth Redirect URIs. Switch the app to Live.',
    fields: [
      { key: 'clientId', label: 'App ID', placeholder: '1234567890123456' },
      { key: 'clientSecret', label: 'App secret', secret: true },
    ],
  },
  apple: {
    blurb: 'Sign in with Apple, through your own Apple Developer account.',
    consoleUrl: 'https://developer.apple.com/account/resources/identifiers/list/serviceId',
    consoleLabel: 'Apple Developer',
    steps: 'Create a Services ID with Sign in with Apple, add your domains and the return URLs below, then create a Sign in with Apple key and download its .p8 file.',
    fields: [
      { key: 'clientId', label: 'Services ID', placeholder: 'com.yourstore.signin' },
      { key: 'teamId', label: 'Team ID', placeholder: 'ABCDE12345' },
      { key: 'keyId', label: 'Key ID', placeholder: 'ABCDE12345' },
      { key: 'privateKey', label: 'Private key (.p8)', secret: true, multiline: true, placeholder: '-----BEGIN PRIVATE KEY-----' },
    ],
  },
  github: {
    blurb: 'Let customers sign in with their GitHub account through your own OAuth app.',
    consoleUrl: 'https://github.com/settings/developers',
    consoleLabel: 'GitHub Developer settings',
    steps: 'Register an OAuth app with the callback URL below. An OAuth app takes one callback URL; to cover more than one host, register a GitHub App instead (it accepts several) and give it read access to email addresses.',
    fields: [
      { key: 'clientId', label: 'Client ID' },
      { key: 'clientSecret', label: 'Client secret', secret: true },
    ],
  },
}

const EMPTY: Record<Field, string> = { clientId: '', clientSecret: '', teamId: '', keyId: '', privateKey: '' }

function ProviderCard({
  initial,
  redirectUris,
}: {
  initial: SignInMethodAdminView
  redirectUris: Array<{ label: string; uri: string }>
}) {
  const p = initial.provider
  const copy = COPY[p]
  const { showToast } = useToast()
  const canWrite = useCanWrite('settings:write')
  const [m, setM] = useState(initial)
  const [values, setValues] = useState<Record<Field, string>>({ ...EMPTY, clientId: initial.clientId, teamId: initial.teamId, keyId: initial.keyId })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function call(method: 'PUT' | 'DELETE', body?: Record<string, unknown>): Promise<SignInMethodAdminView | null> {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/admin/sign-in-methods/${p}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error || 'Failed to save')
        showToast(data?.error || 'Failed to save', 'error')
        return null
      }
      const next = data.method as SignInMethodAdminView
      setM(next)
      setValues({ ...EMPTY, clientId: next.clientId, teamId: next.teamId, keyId: next.keyId })
      return next
    } finally {
      setBusy(false)
    }
  }

  async function toggle(enabled: boolean) {
    if (await call('PUT', { enabled })) showToast(enabled ? `${SOCIAL_LABEL[p]} sign-in is on` : `${SOCIAL_LABEL[p]} sign-in is off`, 'success')
  }

  async function save() {
    const body: Record<string, string> = {}
    for (const f of copy.fields) body[f.key] = values[f.key].trim()
    if (await call('PUT', body)) showToast('Saved', 'success')
  }

  async function remove() {
    if (await call('DELETE')) showToast('Removed', 'success')
  }

  const canToggle = canWrite && !busy && (p === 'google' || m.configured)
  const status =
    !m.enabled ? (
      <Badge tone="muted">Off</Badge>
    ) : m.configured ? (
      <Badge tone="green">On, your app</Badge>
    ) : p === 'google' ? (
      <Badge tone="blue">On, platform app</Badge>
    ) : (
      <Badge tone="muted">Not set up</Badge>
    )

  return (
    <section className="bg-surface-elevated border border-border-default rounded-xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span className="mt-0.5 text-foreground">
            <SocialIcon provider={p} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">{SOCIAL_LABEL[p]}</h2>
              {status}
            </div>
            <p className="text-xs text-foreground-muted mt-1">{copy.blurb}</p>
          </div>
        </div>
        <Toggle checked={m.enabled} onChange={toggle} disabled={!canToggle} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-4">
        {copy.fields.map(f => {
          const stored = f.secret && m.configured
          const placeholder = stored
            ? f.key === 'privateKey'
              ? 'Stored. Paste a new key to replace it.'
              : `Stored, ends in ${m.secretLast4}. Type a new one to replace it.`
            : f.placeholder
          const id = `signin-${p}-${f.key}`
          return (
            <div key={f.key} className={f.multiline ? 'lg:col-span-2' : ''}>
              <label htmlFor={id} className="block text-sm font-medium text-foreground mb-1">
                {f.label}
              </label>
              {f.multiline ? (
                <textarea
                  id={id}
                  rows={4}
                  value={values[f.key]}
                  placeholder={placeholder}
                  onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
                  disabled={busy || !canWrite}
                  spellCheck={false}
                  autoComplete="off"
                  className={`${inputCls} font-mono text-xs disabled:opacity-60`}
                />
              ) : (
                <input
                  id={id}
                  type={f.secret ? 'password' : 'text'}
                  value={values[f.key]}
                  placeholder={placeholder}
                  onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
                  disabled={busy || !canWrite}
                  spellCheck={false}
                  autoComplete={f.secret ? 'new-password' : 'off'}
                  className={`${inputCls} disabled:opacity-60`}
                />
              )}
            </div>
          )
        })}
      </div>

      <div>
        <p className="text-sm font-medium text-foreground mb-1">{redirectUris.length > 1 ? 'Redirect URIs' : 'Redirect URI'}</p>
        <ul className="space-y-1.5">
          {redirectUris.map(r => (
            <li key={r.uri} className="flex items-center gap-2 rounded-lg border border-border-default bg-surface px-3 py-2">
              <span className="shrink-0 text-xs text-foreground-muted w-28 truncate">{r.label}</span>
              <code className="min-w-0 flex-1 truncate text-xs text-foreground">{r.uri}</code>
              <CopyValue value={r.uri} label="Copy redirect URI" />
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-foreground-muted">
          {copy.steps}{' '}
          <a href={copy.consoleUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent-600 dark:text-accent-400 hover:underline">
            {copy.consoleLabel}
            <ExternalLink className="w-3 h-3" />
          </a>
        </p>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      {canWrite && (
        <div className="flex items-center gap-2">
          <button type="button" onClick={save} disabled={busy} className={btnPrimary}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          {m.configured && (
            <button type="button" onClick={remove} disabled={busy} className={btnGhost}>
              Remove app
            </button>
          )}
        </div>
      )}
    </section>
  )
}

export default function SignInMethodsCard({
  methods,
  redirectUris,
}: {
  methods: SignInMethodAdminView[]
  redirectUris: Record<SocialProvider, Array<{ label: string; uri: string }>>
}) {
  return (
    <>
      <p className="text-sm text-foreground-secondary">
        How customers sign in to your storefront and business portal. With your own app for a provider, its consent
        screen carries your store name and logo. Email and mobile codes always stay available. Admin sign-in is not
        affected.
      </p>
      {methods.map(m => (
        <ProviderCard key={m.provider} initial={m} redirectUris={redirectUris[m.provider] ?? []} />
      ))}
    </>
  )
}
