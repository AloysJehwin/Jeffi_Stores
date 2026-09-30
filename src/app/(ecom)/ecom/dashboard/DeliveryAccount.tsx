'use client'

import { useState } from 'react'

export default function DeliveryAccount({
  tenantId,
  ownDelhivery,
  tokenConnected,
}: {
  tenantId: string
  ownDelhivery: boolean
  tokenConnected: boolean
}) {
  const [connected, setConnected] = useState(tokenConnected)
  const [open, setOpen] = useState(false)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const save = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/ecom/delivery-account', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, token: token.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not save the token')
      setConnected(true)
      setToken('')
      setOpen(false)
      setMsg({ ok: true, text: 'Delhivery token verified and saved. New shipments use it right away.' })
    } catch (err: any) {
      setMsg({ ok: false, text: err.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-2xl border border-border-default bg-surface-elevated p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-foreground-secondary uppercase tracking-widest">Delivery account</div>
        {ownDelhivery && (
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
              connected
                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
            }`}
          >
            {connected ? 'Token connected' : 'Token missing'}
          </span>
        )}
      </div>

      {!ownDelhivery ? (
        <p className="text-sm text-foreground-secondary">
          Your store ships on the platform Delhivery account, and courier charges are paid from your wallet. To ship on
          your own Delhivery account instead, contact support.
        </p>
      ) : (
        <>
          <p className="text-sm text-foreground-secondary">
            Your store ships on your own Delhivery account and Delhivery bills you directly.
            {!connected && ' No API token is on file, so shipments cannot be created until you add one.'}
          </p>

          {open ? (
            <div className="mt-4 space-y-3">
              <div>
                <label htmlFor="delhivery-token" className="block text-xs font-medium text-foreground-secondary mb-1">
                  Delhivery API token
                </label>
                <input
                  id="delhivery-token"
                  type="password"
                  autoComplete="off"
                  value={token}
                  onChange={e => setToken(e.target.value)}
                  placeholder="Paste your Delhivery API token"
                  disabled={busy}
                  className="w-full px-3 py-2 rounded-lg border border-border-default bg-surface text-foreground text-sm focus:ring-2 focus:ring-accent-500 focus:border-transparent"
                />
                <p className="text-xs text-foreground-secondary mt-1.5">
                  Use a token from the same Delhivery account. Shipments already created stay tied to the account that
                  created them. The token is checked with Delhivery before it is saved.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={save}
                  disabled={busy || token.trim().length < 8}
                  className="px-4 py-2 rounded-lg bg-accent-600 hover:bg-accent-700 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {busy ? 'Verifying...' : 'Verify and save'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    setToken('')
                    setMsg(null)
                  }}
                  disabled={busy}
                  className="px-4 py-2 rounded-lg text-sm text-foreground-secondary hover:text-foreground disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setOpen(true)
                setMsg(null)
              }}
              className="mt-3 text-sm font-medium text-accent-600 dark:text-accent-400 hover:underline"
            >
              {connected ? 'Replace token' : 'Add token'}
            </button>
          )}
        </>
      )}

      {msg && (
        <p
          className={`text-sm mt-3 ${msg.ok ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
        >
          {msg.text}
        </p>
      )}
    </div>
  )
}
