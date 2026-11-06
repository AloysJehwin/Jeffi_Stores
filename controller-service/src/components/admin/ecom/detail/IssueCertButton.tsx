'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { KeyRound } from 'lucide-react'
import { ActionButton, Dialog, FormButton, FormField, TextInput, useActionToast } from '@/components/admin/kit'

/** Issue (or re-issue) a super_admin client certificate for the store; the invite goes by email. Platform admins only. */
export default function IssueCertButton({ tenantId, ownerEmail, hasActive }: { tenantId: string; ownerEmail: string | null; hasActive: boolean }) {
  const router = useRouter()
  const toast = useActionToast()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState(ownerEmail ?? '')
  const [revoke, setRevoke] = useState(false)
  const [pending, setPending] = useState(false)
  const other = !ownerEmail || email.trim().toLowerCase() !== ownerEmail.toLowerCase()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setPending(true)
    try {
      const res = await fetch(`/api/admin/ecom/${tenantId}/certs/issue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() || undefined, revokeExisting: revoke }),
      }).catch(() => null)
      const data = await res?.json().catch(() => ({}))
      if (!res?.ok) return toast.error(data?.error || 'Could not issue the certificate')
      const revoked = data.revoked?.length ? `; revoked ${data.revoked.length}` : ''
      if (data.emailed === false) toast.warning(`Issued to ${data.issuedTo}, but the invite email failed${revoked}. Re-issue to send it again.`)
      else toast.success(`Certificate issued to ${data.issuedTo}${revoked}`)
      setOpen(false)
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <ActionButton
        action={{ label: hasActive ? 'Re-issue certificate' : 'Issue certificate', icon: KeyRound, onClick: () => setOpen(true), scope: 'ecom_customers:write' }}
      />
      <Dialog
        open={open}
        onClose={() => !pending && setOpen(false)}
        title={hasActive ? 'Re-issue admin certificate' : 'Issue admin certificate'}
        description="A new client certificate from the store's own CA. The holder gets an email to collect it from the certificate portal."
        footer={
          <>
            <FormButton type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </FormButton>
            <FormButton form="issue-cert-form" pending={pending} pendingLabel="Issuing…">
              Issue
            </FormButton>
          </>
        }
      >
        <form id="issue-cert-form" onSubmit={submit} className="space-y-4 min-w-0">
          <FormField
            label="Email"
            htmlFor="issue-cert-email"
            required
            hint={
              other
                ? 'Not the store owner: this creates another super_admin with full access to the store.'
                : 'The store owner.'
            }
          >
            <TextInput id="issue-cert-email" type="email" required autoComplete="off" value={email} onChange={e => setEmail(e.target.value)} />
          </FormField>
          <label className="flex items-start gap-2 text-sm text-foreground cursor-pointer">
            <input type="checkbox" checked={revoke} onChange={e => setRevoke(e.target.checked)} className="mt-0.5 rounded" />
            <span className="min-w-0">
              Revoke this admin&apos;s current certificates
              <span className="block text-xs text-foreground-muted">They stop opening the admin panel once the new one is issued.</span>
            </span>
          </label>
        </form>
      </Dialog>
    </>
  )
}
