'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { Check } from 'lucide-react'
import { ap } from '@/lib/shared/admin-path'
import { PageBody, PageHeader } from '@/components/admin/kit/layout'
import { FormButton, FormField, FormFooter, FormGrid, FormPage, FormSection, NumberInput, TextArea, TextInput } from '@/components/admin/kit/form'
import { ErrorState } from '@/components/admin/kit/states'
import { useActionToast } from '@/components/admin/kit/toast'
import { RequireWrite } from '@/contexts/AdminScopesContext'
import MobileEditBlock from '@/components/admin/MobileEditBlock'
import { DraftNotice, EditSessionActions } from '@/components/admin/kit'
import { useEditSession } from '@/hooks/useEditSession'
import type { AutosaveStatus } from '@/hooks/useAutosaveDraft'


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

export default function EditSupplierPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const id = params.id
  const [form, setForm] = useState(emptyForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [hasDraft, setHasDraft] = useState(false)
  const toast = useActionToast()
  const setError = (text: string) => text && toast.error(text)
  const [loadError, setLoadError] = useState('')
  const listHref = ap('/admin/suppliers?tab=suppliers')
  const [ifscLookup, setIfscLookup] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const edit = useEditSession({ resourceType: 'supplier', resourceId: id ?? null })

  useEffect(() => {
    Promise.all([
      fetch(`/api/admin/suppliers/${id}`).then(r => r.json()),
      fetch(`/api/admin/suppliers/${id}/draft`, { credentials: 'include' }).then(r => r.json()),
    ])
      .then(([supplierJson, draftJson]) => {
        const s = supplierJson.supplier
        if (!s) {
          setLoadError('Supplier not found')
          return
        }
        const live = {
          name: s.name || '',
          gstin: s.gstin || '',
          contact_name: s.contact_name || '',
          phone: (s.phone || '')
            .replace(/^\+?91/, '')
            .replace(/\D/g, '')
            .slice(-10),
          email: s.email || '',
          address: s.address || '',
          payment_terms: String(s.payment_terms ?? '30'),
          notes: s.notes || '',
          bank_name: s.bank_name || '',
          account_number: s.account_number || '',
          ifsc: s.ifsc || '',
          upi_id: s.upi_id || '',
        }
        const df = draftJson.draft_fields
        if (df) {
          setHasDraft(true)
          setForm({
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
          })
        } else {
          setForm(live)
        }
      })
      .catch(() => setLoadError('Failed to load supplier'))
      .finally(() => setLoading(false))

    // Auto-create draft on first visit
    fetch(`/api/admin/suppliers/${id}/draft`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).then(() => setHasDraft(true))
  }, [id])

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
      const res = await fetch(`/api/admin/suppliers/${id}/draft`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const j = await res.json()
        setError(j.error || 'Failed to save draft')
        return
      }
      setHasDraft(true)
      router.push(ap('/admin/suppliers?tab=suppliers'))
    } finally {
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
      // Save latest form to draft first, then publish
      await fetch(`/api/admin/suppliers/${id}/draft`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const res = await fetch(`/api/admin/suppliers/${id}/draft`, { method: 'POST', credentials: 'include' })
      if (!res.ok) {
        const j = await res.json()
        setError(j.error || 'Failed to publish')
        return
      }
      router.push(ap('/admin/suppliers?tab=suppliers'))
    } finally {
      setPublishing(false)
    }
  }

  async function discardDraft() {
    await fetch(`/api/admin/suppliers/${id}/draft`, { method: 'DELETE', credentials: 'include' })
    setHasDraft(false)
    // Reload from live
    const res = await fetch(`/api/admin/suppliers/${id}`)
    const json = await res.json()
    const s = json.supplier
    if (s)
      setForm({
        name: s.name || '',
        gstin: s.gstin || '',
        contact_name: s.contact_name || '',
        phone: (s.phone || '')
          .replace(/^\+?91/, '')
          .replace(/\D/g, '')
          .slice(-10),
        email: s.email || '',
        address: s.address || '',
        payment_terms: String(s.payment_terms ?? '30'),
        notes: s.notes || '',
        bank_name: s.bank_name || '',
        account_number: s.account_number || '',
        ifsc: s.ifsc || '',
        upi_id: s.upi_id || '',
      })
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
          saveDraft()
        }}
      >
        <FormPage
          header={
            <>
              {edit.sessionId && (
                <div className="flex justify-end">
                  <EditSessionActions
                    autosaveStatus={'idle' as AutosaveStatus}
                    sessionStatus={edit.status}
                    onCancel={edit.cancel}
                    cancelHref={ap('/admin/suppliers')}
                    draft={hasDraft}
                  />
                </div>
              )}
              <PageHeader back={{ href: listHref, label: 'Suppliers' }} title={hasDraft ? 'Edit Draft' : 'Edit Supplier'} description={form.name} />
              {hasDraft && (
                <DraftNotice state="draft" onDiscard={discardDraft} />
              )}
            </>
          }
          footer={
            <FormFooter cancelHref={listHref}>
              <RequireWrite scope="inventory">
                <FormButton variant="secondary" disabled={saving || !form.name.trim()} pending={saving} pendingLabel="Saving…">
                  Save Draft
                </FormButton>
                <FormButton type="button" onClick={publish} disabled={publishing || !form.name.trim()} pending={publishing} pendingLabel="Publishing…">
                  Publish
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
