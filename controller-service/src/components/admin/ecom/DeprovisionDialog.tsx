'use client'

import { useState } from 'react'
import { Dialog, FormButton } from '@/components/admin/kit'

export type KeepChoice = { database: boolean; media: boolean; config: boolean }

const ITEMS: { key: keyof KeepChoice; label: string; what: string }[] = [
  { key: 'database', label: 'Database', what: 'Products, customers, orders and everything else the store recorded.' },
  { key: 'media', label: 'Media files', what: 'Product images, uploads and documents in the store’s bucket.' },
  { key: 'config', label: 'Configuration', what: 'Plan, custom domains and the store’s settings.' },
]

/**
 * Deprovision asks the administrator what to keep for the store's owner. Nothing is chosen for
 * them: each item needs "Keep" or "Delete" before the button works.
 */
export default function DeprovisionDialog({
  open,
  slug,
  retentionDays,
  onClose,
  onConfirm,
}: {
  open: boolean
  slug: string
  retentionDays: number
  onClose: () => void
  onConfirm: (keep: KeepChoice) => Promise<void>
}) {
  const [choice, setChoice] = useState<Partial<KeepChoice>>({})
  const [pending, setPending] = useState(false)
  const ready = ITEMS.every(i => typeof choice[i.key] === 'boolean')
  const keepsAny = ITEMS.some(i => choice[i.key] === true)

  const close = () => {
    if (pending) return
    setChoice({})
    onClose()
  }
  const submit = async () => {
    if (!ready) return
    setPending(true)
    try {
      await onConfirm(choice as KeepChoice)
      setChoice({})
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title={`Deprovision "${slug}"?`}
      description="The store goes offline immediately. Its database, bucket and servers are deleted, and its API keys and certificates are revoked. This cannot be undone."
      footer={
        <>
          <FormButton type="button" variant="secondary" onClick={close} disabled={pending}>
            Cancel
          </FormButton>
          <FormButton
            type="button"
            onClick={submit}
            disabled={!ready}
            pending={pending}
            pendingLabel="Deprovisioning…"
            className="!bg-red-600 hover:!bg-red-700"
          >
            Deprovision
          </FormButton>
        </>
      }
    >
      <div className="space-y-4 min-w-0">
        <p className="text-sm text-foreground-secondary">Choose what to keep for the owner. Anything set to Delete is removed now, with no copy.</p>
        {ITEMS.map(item => (
          <fieldset key={item.key} className="rounded-lg border border-border-default p-3 min-w-0">
            <legend className="px-1 text-sm font-semibold text-foreground">{item.label}</legend>
            <p className="text-xs text-foreground-secondary">{item.what}</p>
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
              {[
                { value: true, text: 'Keep for the owner' },
                { value: false, text: 'Delete now' },
              ].map(o => (
                <label key={String(o.value)} className="inline-flex items-center gap-2 cursor-pointer text-sm text-foreground">
                  <input
                    type="radio"
                    name={`keep-${item.key}`}
                    checked={choice[item.key] === o.value}
                    onChange={() => setChoice(c => ({ ...c, [item.key]: o.value }))}
                    disabled={pending}
                    className="w-4 h-4 accent-accent-600"
                  />
                  {o.text}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <p className="text-xs text-foreground-secondary">
          {keepsAny
            ? `What you keep stays for ${retentionDays} days. If the same owner sets up a store again in that time, they can restore it and take the store name back. After that it is deleted.`
            : ready
              ? 'Nothing is kept: the owner cannot restore this store.'
              : 'Pick Keep or Delete for each item to continue.'}
        </p>
      </div>
    </Dialog>
  )
}
