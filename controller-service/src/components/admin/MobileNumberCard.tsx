'use client'

import { useEffect, useState } from 'react'

// The admin's mobile number: verified with a code on WhatsApp (or SMS). The certificate portal asks for
// it before a download, and the admin assistant answers on WhatsApp from it.
export default function MobileNumberCard() {
  const [mobile, setMobile] = useState<string | null | undefined>(undefined)
  const [editing, setEditing] = useState(false)
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [sentBy, setSentBy] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/admin/account/mobile', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => setMobile(d?.mobile ?? null))
      .catch(() => setMobile(null))
  }, [])

  async function call(path: string, body: object) {
    setBusy(true)
    setError('')
    const res = await fetch(`/api/admin/account/mobile/${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null)
    const data = await res?.json().catch(() => ({}))
    setBusy(false)
    if (!res?.ok) setError(data?.error || 'Something went wrong. Try again.')
    return res?.ok ? data : null
  }

  if (mobile === undefined) return <div className="text-sm text-foreground-muted">Loading…</div>

  const input = 'w-full px-3 h-control-sm rounded-lg border border-border-secondary bg-surface text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500'
  const button = 'h-control-sm px-3 rounded-lg text-xs font-semibold bg-accent-500 hover:bg-accent-600 text-white disabled:opacity-50 whitespace-nowrap'
  return (
    <div className="space-y-3">
      <p className="text-sm text-foreground-secondary">
        {mobile ? (
          <>
            Verified: <span className="font-medium text-foreground">{mobile}</span>
          </>
        ) : (
          'No number yet. You will be asked for one before your next certificate download.'
        )}
      </p>
      <p className="text-xs text-foreground-muted">Used to confirm certificate downloads, and the number the admin assistant answers on WhatsApp.</p>
      {!editing ? (
        <button type="button" className="text-sm font-semibold text-accent-600 hover:underline" onClick={() => setEditing(true)}>
          {mobile ? 'Change number' : 'Add a number'}
        </button>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input className={input} type="tel" placeholder="+91 98765 43210" value={phone} onChange={e => setPhone(e.target.value)} disabled={busy} />
            <button
              type="button"
              className={button}
              disabled={busy || phone.replace(/\D/g, '').length < 10}
              onClick={async () => {
                const d = await call('send-otp', { phone })
                if (d) setSentBy(d.channel === 'whatsapp' ? 'WhatsApp' : 'SMS')
              }}
            >
              {sentBy ? 'Send again' : 'Send code'}
            </button>
          </div>
          {sentBy && (
            <div className="flex gap-2">
              <input className={input} inputMode="numeric" maxLength={6} placeholder={`Code sent on ${sentBy}`} value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ''))} disabled={busy} />
              <button
                type="button"
                className={button}
                disabled={busy || otp.length !== 6}
                onClick={async () => {
                  const d = await call('verify-otp', { otp })
                  if (d) {
                    setMobile(d.mobile)
                    setEditing(false)
                    setSentBy(null)
                    setPhone('')
                    setOtp('')
                  }
                }}
              >
                Verify
              </button>
            </div>
          )}
        </div>
      )}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
