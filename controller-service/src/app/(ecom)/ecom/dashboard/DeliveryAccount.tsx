'use client'

import { useState } from 'react'
import { useToast } from '@/contexts/ToastContext'
import { ghostBtn, primaryBtn } from '../onboard/ui'
import { Card } from './_components/Card'

export default function DeliveryAccount({
  tenantId,
  ownDelhivery,
  tokenConnected,
}: {
  tenantId: string
  ownDelhivery: boolean
  tokenConnected: boolean
}) {
  const { showToast } = useToast()
  const [connected, setConnected] = useState(tokenConnected)
  const [open, setOpen] = useState(false)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
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
      showToast('Delhivery token verified and saved. New shipments use it right away.', 'success')
    } catch (err: any) {
      showToast(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const badge = ownDelhivery && (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${connected ? 'org-sage org-sage-text' : 'bg-[#f2d4cd] text-[#8a2e1f]'}`}>
      {connected ? 'Token connected' : 'Token missing'}
    </span>
  )

  return (
    <Card title="Delivery account" action={badge || undefined}>
      {!ownDelhivery ? (
        <p className="text-sm text-foreground-secondary">
          Orders ship on our Delhivery account, and courier charges are paid from your wallet. To ship on your own
          Delhivery account instead,{' '}
          <a href="mailto:support@jeffistores.in" className="font-semibold ecom-accent-text hover:underline">
            contact support
          </a>
          .
        </p>
      ) : (
        <>
          <p className="text-sm text-foreground-secondary">
            Orders ship on your own Delhivery account, and Delhivery bills you directly.
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
                  className="w-full px-3 py-2 rounded-xl border border-border-default bg-surface text-foreground text-sm ecom-field"
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
                  className={primaryBtn}
                >
                  {busy ? 'Verifying...' : 'Verify and save'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    setToken('')
                  }}
                  disabled={busy}
                  className={ghostBtn}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="mt-3 text-sm font-medium text-accent-600 hover:underline"
            >
              {connected ? 'Replace token' : 'Add token'}
            </button>
          )}
        </>
      )}
    </Card>
  )
}
