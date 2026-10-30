'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check } from 'lucide-react'
import { ap } from '@/lib/shared/admin-path'
import { PageHeader } from '@/components/admin/kit/layout'
import { FormButton, FormField, FormFooter, FormGrid, FormPage, FormSection, NumberInput, TextArea, TextInput } from '@/components/admin/kit/form'
import { useActionToast } from '@/components/admin/kit/toast'
import { RequireWrite } from '@/contexts/AdminScopesContext'
import MobileEditBlock from '@/components/admin/MobileEditBlock'


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

export default function NewSupplierPage() {
  const router = useRouter()
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const toast = useActionToast()
  const setError = (text: string) => text && toast.error(text)
  const listHref = ap('/admin/suppliers?tab=suppliers&active=true')
  const [ifscLookup, setIfscLookup] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) {
      setError('Supplier name is required')
      return
    }
    setError('')
    setSaving(true)
    try {
      const res = await fetch('/api/admin/inventory/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || 'Failed to create supplier')
        setSaving(false)
        return
      }
      router.push(ap('/admin/suppliers?tab=suppliers&active=true'))
    } catch {
      setError('Failed to create supplier')
      setSaving(false)
    }
  }

  return (
    <MobileEditBlock>
      <form onSubmit={handleSubmit}>
        <FormPage
          header={<PageHeader back={{ href: listHref, label: 'Suppliers' }} title="New Supplier" description="Add a new vendor or supplier" />}
          footer={
            <FormFooter cancelHref={listHref}>
              <RequireWrite scope="inventory">
                <FormButton disabled={saving || !form.name.trim()} pending={saving} pendingLabel="Saving...">
                  Create Supplier
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
