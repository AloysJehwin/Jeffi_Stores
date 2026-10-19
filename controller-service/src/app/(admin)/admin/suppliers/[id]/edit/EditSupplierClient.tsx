'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Check } from 'lucide-react'
import { ap } from '@/lib/shared/admin-path'
import { PageBody, PageHeader } from '@/components/admin/kit/layout'
import { Badge } from '@/components/admin/kit'
import { FormButton, FormField, FormFooter, FormGrid, FormPage, FormSection, NumberInput, TextArea, TextInput } from '@/components/admin/kit/form'
import { ErrorState } from '@/components/admin/kit/states'
import { useActionToast } from '@/components/admin/kit/toast'
import { RequireWrite } from '@/contexts/AdminScopesContext'
import MobileEditBlock from '@/components/admin/MobileEditBlock'
import { useEditSession } from '@/hooks/useEditSession'
import { useAutosaveDraft } from '@/hooks/useAutosaveDraft'
import AutosaveStatusPill from '@/components/admin/AutosaveStatusPill'
import { resnapshotSupplierSession } from './actions'


const emptyForm = {
  name: '',
  gstin: '',
  contact_name: '',
  phone: '',
  email: '',
  address: '',
  payment_terms: '30',
  notes: '',
  bank_name: '',
  account_number: '',
  ifsc: '',
  upi_id: '',
}

type SupplierForm = typeof emptyForm

function normalizePhone(raw: string) {
  return (raw || '').replace(/^\+?91/, '').replace(/\D/g, '').slice(-10)
}

function liveToForm(s: any): SupplierForm {
  return {
    name: s.name || '',
    gstin: s.gstin || '',
    contact_name: s.contact_name || '',
    phone: normalizePhone(s.phone || ''),
    email: s.email || '',
    address: s.address || '',
    payment_terms: String(s.payment_terms ?? '30'),
    notes: s.notes || '',
    bank_name: s.bank_name || '',
    account_number: s.account_number || '',
    ifsc: s.ifsc || '',
    upi_id: s.upi_id || '',
  }
}

function mergeDraft(live: SupplierForm, df: Record<string, any>): SupplierForm {
  return {
    name: df.name ?? live.name,
    gstin: df.gstin ?? live.gstin,
    contact_name: df.contact_name ?? live.contact_name,
    phone: df.phone ?? live.phone,
    email: df.email ?? live.email,
    address: df.address ?? live.address,
    payment_terms: df.payment_terms ?? live.payment_terms,
    notes: df.notes ?? live.notes,
    bank_name: df.bank_name ?? live.bank_name,
    account_number: df.account_number ?? live.account_number,
    ifsc: df.ifsc ?? live.ifsc,
    upi_id: df.upi_id ?? live.upi_id,
  }
}

export default function EditSupplierClient({ id }: { id: string }) {
  const router = useRouter()
  const [form, setForm] = useState<SupplierForm>(emptyForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [hasDraft, setHasDraft] = useState(false)
  const toast = useActionToast()
  const setError = (text: string) => text && toast.error(text)
  const [loadError, setLoadError] = useState('')
  const listHref = ap('/admin/suppliers?tab=suppliers')
  const viewHref = ap(`/admin/suppliers/${id}/view`)
  const [ifscLookup, setIfscLookup] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const edit = useEditSession({ resourceType: 'supplier', resourceId: id ?? null })

  // Autosave bookkeeping — mirrors the Product editor so Cancel/Discard can wait on in-flight.
  const autosaveBlockedRef = useRef(false)
  const inFlightRef = useRef(false)
  const didHydrateRef = useRef(false)

  // Autosave shares the PATCH endpoint; payload stays byte-identical to Save as Draft.
  const autosave = useAutosaveDraft<SupplierForm>({
    enabled: v => !!v.name.trim() && !autosaveBlockedRef.current,
    save: async (value, signal) => {
      inFlightRef.current = true
      try {
        const r = await fetch(`/api/admin/suppliers/${id}/draft`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(value),
          signal,
        })
        if (!r.ok) {
          const j = await r.json().catch(() => ({}))
          throw new Error(j?.error || `HTTP ${r.status}`)
        }
        setHasDraft(true)
      } finally {
        inFlightRef.current = false
      }
    },
  })

  async function hydrate() {
    try {
      const [supplierJson, draftJson] = await Promise.all([
        fetch(`/api/admin/suppliers/${id}`).then(r => r.json()),
        fetch(`/api/admin/suppliers/${id}/draft`, { credentials: 'include' }).then(r => r.json()),
      ])
      const s = supplierJson.supplier
      if (!s) {
        setLoadError('Supplier not found')
        return
      }
      const live = liveToForm(s)
      const df = draftJson.draft_fields
      if (df) {
        setHasDraft(true)
        setForm(mergeDraft(live, df))
      } else {
        setHasDraft(false)
        setForm(live)
      }
    } catch {
      setLoadError('Failed to load supplier')
    } finally {
      setLoading(false)
    }
  }

  // Load live + draft, then ensure the draft row exists (idempotent — never wipes if already there).
  useEffect(() => {
    void hydrate().then(async () => {
      didHydrateRef.current = true
      // Keep the on-mount PATCH so a direct /edit visit still works; the server's PATCH is a
      // replace, so only touch it when no draft was fetched (otherwise it would wipe fields).
      try {
        const r = await fetch(`/api/admin/suppliers/${id}/draft`, { credentials: 'include' })
        const j = await r.json().catch(() => ({}))
        if (!j?.draft_fields) {
          await fetch(`/api/admin/suppliers/${id}/draft`, {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          })
          setHasDraft(true)
        }
      } catch {
        // Non-fatal — autosave will create the row on first edit.
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Trigger autosave on form change after the initial hydrate.
  useEffect(() => {
    if (!didHydrateRef.current) return
    autosave.trigger(form)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form])

  async function lookupIfsc(code: string) {
    const clean = code.trim().toUpperCase()
    if (clean.length !== 11) return
    setIfscLookup('loading')
    try {
      const res = await fetch(`https://ifsc.razorpay.com/${clean}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setForm(f => ({ ...f, bank_name: data.BANK || f.bank_name }))
      setIfscLookup('ok')
    } catch {
      setIfscLookup('error')
    }
  }

  async function saveDraft() {
    if (!form.name.trim()) {
      setError('Supplier name is required')
      return
    }
    setError('')
    setSaving(true)
    try {
      await autosave.flush(form)
      setHasDraft(true)
      // Resnapshot so a later Cancel reverts to this saved draft, not the pre-session state.
      await resnapshotSupplierSession(id)
      router.push(listHref)
    } catch (e: any) {
      setError(e?.message || 'Failed to save draft')
      setSaving(false)
    }
  }

  async function publish() {
    if (!form.name.trim()) {
      setError('Supplier name is required')
      return
    }
    setError('')
    setPublishing(true)
    try {
      await autosave.flush(form)
      const res = await fetch(`/api/admin/suppliers/${id}/draft`, { method: 'POST', credentials: 'include' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j.error || 'Failed to publish')
        setPublishing(false)
        return
      }
      // Draft row is deleted on publish — close the open session, redirect to the list.
      await edit.save().catch(() => undefined)
      router.push(listHref)
    } catch (e: any) {
      setError(e?.message || 'Failed to publish')
      setPublishing(false)
    }
  }

  async function discardDraft() {
    autosaveBlockedRef.current = true
    for (let i = 0; i < 100 && inFlightRef.current; i++) await new Promise(r => setTimeout(r, 100))
    try {
      const r = await fetch(`/api/admin/suppliers/${id}/draft`, { method: 'DELETE', credentials: 'include' })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        setError(j.error || 'Failed to discard draft')
        autosaveBlockedRef.current = false
        return
      }
      await edit.save().catch(() => undefined)
      router.push(viewHref)
    } catch (e: any) {
      setError(e?.message || 'Failed to discard draft')
      autosaveBlockedRef.current = false
    }
  }

  async function cancelEdit() {
    autosaveBlockedRef.current = true
    for (let i = 0; i < 100 && inFlightRef.current; i++) await new Promise(r => setTimeout(r, 100))
    const ok = await edit.cancel()
    if (!ok) {
      autosaveBlockedRef.current = false
      return
    }
    router.push(viewHref)
  }

  if (loading) return null

  if (loadError)
    return (
      <PageBody>
        <ErrorState
          title={loadError}
          actionNode={
            <Link href={listHref} className="control-md border border-border-default text-foreground hover:bg-surface-secondary">
              Back to Suppliers
            </Link>
          }
        />
      </PageBody>
    )

  return (
    <MobileEditBlock>
      <form
        onSubmit={e => {
          e.preventDefault()
          void saveDraft()
        }}
      >
        <FormPage
          header={
            <PageHeader
              back={{ href: listHref, label: 'Suppliers' }}
              title={hasDraft ? 'Edit Draft' : 'Edit Supplier'}
              description={hasDraft ? 'Changes are saved to the draft only' : 'Update supplier information'}
              badges={hasDraft ? <Badge tone="amber">Draft pending</Badge> : undefined}
            />
          }
          footer={
            <FormFooter
              autosave={<AutosaveStatusPill status={autosave.status} />}
              draftBadge={hasDraft ? <Badge tone="amber">Draft pending</Badge> : undefined}
              discard={hasDraft ? discardDraft : undefined}
              cancel={edit.sessionId ? cancelEdit : undefined}
              cancelHref={edit.sessionId ? undefined : listHref}
            >
              <RequireWrite scope="inventory">
                <FormButton
                  type="button"
                  variant="secondary"
                  onClick={() => void saveDraft()}
                  disabled={saving || !form.name.trim()}
                  pending={saving}
                  pendingLabel="Saving…"
                >
                  Save as Draft
                </FormButton>
                <FormButton
                  type="button"
                  onClick={() => void publish()}
                  disabled={publishing || !form.name.trim()}
                  pending={publishing}
                  pendingLabel="Publishing…"
                >
                  Update &amp; Publish
                </FormButton>
              </RequireWrite>
            </FormFooter>
          }
        >
          <FormSection title="Basic Information">
            <FormGrid cols={3}>
              <FormField label="Name" htmlFor="sup-name" required>
                <TextInput id="sup-name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Supplier or company name" />
              </FormField>
              <FormField label="GSTIN" htmlFor="sup-gstin">
                <TextInput
                  id="sup-gstin"
                  className="font-mono"
                  value={form.gstin}
                  onChange={e => setForm(f => ({ ...f, gstin: e.target.value.toUpperCase() }))}
                  placeholder="00XXXXX0000X0Z0"
                  maxLength={15}
                />
              </FormField>
              <FormField label="Payment Terms (days)" htmlFor="sup-terms">
                <NumberInput id="sup-terms" min="0" value={form.payment_terms} onChange={e => setForm(f => ({ ...f, payment_terms: e.target.value }))} placeholder="30" />
              </FormField>
              <FormField label="Contact Name" htmlFor="sup-contact">
                <TextInput id="sup-contact" value={form.contact_name} onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))} />
              </FormField>
              <FormField label="Phone" htmlFor="sup-phone">
                <div className="flex">
                  <span className="inline-flex h-control items-center px-3 rounded-l-lg border border-r-0 border-border-default bg-surface-secondary text-foreground-secondary text-sm select-none">+91</span>
                  <TextInput
                    id="sup-phone"
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    className="rounded-l-none"
                    value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
                    placeholder="XXXXXXXXXX"
                  />
                </div>
              </FormField>
              <FormField label="Email" htmlFor="sup-email">
                <TextInput id="sup-email" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
              </FormField>
              <FormField label="Address" htmlFor="sup-address" span={3}>
                <TextArea id="sup-address" rows={2} value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
              </FormField>
              <FormField label="Notes" htmlFor="sup-notes" span={3}>
                <TextArea id="sup-notes" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </FormField>
            </FormGrid>
          </FormSection>

          <FormSection title="Bank & Payment Details">
            <FormGrid cols={2}>
              <FormField label="IFSC Code" htmlFor="sup-ifsc">
                <div className="relative">
                  <TextInput
                    id="sup-ifsc"
                    value={form.ifsc}
                    onChange={e => {
                      setForm(f => ({ ...f, ifsc: e.target.value.toUpperCase() }))
                      setIfscLookup('idle')
                    }}
                    onBlur={e => lookupIfsc(e.target.value)}
                    placeholder="e.g. HDFC0001234"
                    maxLength={11}
                  />
                  {ifscLookup === 'loading' && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-foreground-secondary">…</span>}
                  {ifscLookup === 'ok' && <Check className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-green-600 dark:text-green-400" />}
                  {ifscLookup === 'error' && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-red-500">?</span>}
                </div>
              </FormField>
              <FormField label="Bank Name" htmlFor="sup-bank">
                <TextInput id="sup-bank" className="bg-surface-secondary/60" value={form.bank_name} onChange={e => setForm(f => ({ ...f, bank_name: e.target.value }))} placeholder="Auto-filled from IFSC" />
              </FormField>
              <FormField label="Account Number" htmlFor="sup-account">
                <TextInput id="sup-account" value={form.account_number} onChange={e => setForm(f => ({ ...f, account_number: e.target.value }))} />
              </FormField>
              <FormField label="UPI ID" htmlFor="sup-upi">
                <TextInput id="sup-upi" value={form.upi_id} onChange={e => setForm(f => ({ ...f, upi_id: e.target.value }))} placeholder="supplier@upi" />
              </FormField>
            </FormGrid>
          </FormSection>
        </FormPage>
      </form>
    </MobileEditBlock>
  )
}
