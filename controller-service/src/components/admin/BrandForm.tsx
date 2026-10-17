'use client'

import { useState, useRef } from 'react'
import ImageUrlInput from '@/components/admin/ImageUrlInput'
import { ap } from '@/lib/shared/admin-path'
import Toggle from '@/components/ui/Toggle'
import AIEnrichButton from './AIEnrichButton'
import AIFillForm from './AIFillForm'
import { useEditSession } from '@/hooks/useEditSession'
import type { AutosaveStatus } from '@/hooks/useAutosaveDraft'
import { EditSessionActions, FormButton, FormField, FormFooter, FormGrid, FormSection, TextArea, TextInput, NumberInput, fieldInputCls, useActionToast } from '@/components/admin/kit'

interface BrandFormProps {
  action: (formData: FormData) => Promise<void>
  brand?: any
  backUrl?: string
  isDraft?: boolean
  submitLabel?: string
  hasReturns?: boolean // false = Basic plan, hides return/replacement policy section
}

export default function BrandForm({
  action,
  brand,
  backUrl,
  isDraft = false,
  submitLabel,
  hasReturns = true,
}: BrandFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [logoUrl, setLogoUrl] = useState(brand?.logo_url || '')
  const [brandName, setBrandName] = useState<string>(brand?.name || '')
  const [description, setDescription] = useState<string>(brand?.description || '')
  const [isActive, setIsActive] = useState<boolean>(brand?.is_active ?? true)
  const [returnAllowed, setReturnAllowed] = useState<boolean>(brand?.return_allowed ?? true)
  const [returnDays, setReturnDays] = useState<number>(brand?.return_window_days ?? 7)
  const [replacementAllowed, setReplacementAllowed] = useState<boolean>(brand?.replacement_allowed ?? true)
  const [replacementDays, setReplacementDays] = useState<number>(brand?.replacement_window_days ?? 7)
  const formRef = useRef<HTMLFormElement>(null)
  const toast = useActionToast()
  const edit = useEditSession({ resourceType: 'brand', resourceId: brand?.id ?? null })

  function setInput(name: string, value: string) {
    const el = formRef.current?.elements.namedItem(name) as HTMLInputElement | null
    if (el) el.value = value
  }

  function handleAIFill(values: Record<string, unknown>) {
    if (values.name) setBrandName(String(values.name))
    if (values.slug)
      setInput(
        'slug',
        String(values.slug)
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '-')
      )
    if (values.description) setDescription(String(values.description))
    if (values.website) setInput('website', String(values.website))
    if (values.is_active != null) setIsActive(Boolean(values.is_active))
    if (values.return_allowed != null) setReturnAllowed(Boolean(values.return_allowed))
    if (values.return_window_days != null) setReturnDays(Number(values.return_window_days))
    if (values.replacement_allowed != null) setReplacementAllowed(Boolean(values.replacement_allowed))
    if (values.replacement_window_days != null) setReplacementDays(Number(values.replacement_window_days))
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsSubmitting(true)

    try {
      const formData = new FormData(e.currentTarget)
      await action(formData)
    } catch (err: any) {
      if (err?.digest?.startsWith('NEXT_REDIRECT')) throw err
      toast.error('Failed to save brand. Please try again.')
      setIsSubmitting(false)
    }
  }

  function generateSlug(name: string) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-5">
      {backUrl && <input type="hidden" name="_back" value={backUrl} />}
      {edit.sessionId && (
        <div className="flex justify-end">
          <EditSessionActions
            autosaveStatus={'idle' as AutosaveStatus}
            sessionStatus={edit.status}
            onCancel={edit.cancel}
            cancelHref={ap('/admin/brands')}
            draft={isDraft}
          />
        </div>
      )}

      <FormSection
        title="Brand"
        description="Name, slug, website, logo and description."
      >
        <AIFillForm
          fields={[
            { name: 'name', label: 'Brand Name', type: 'text' },
            { name: 'slug', label: 'URL Slug', type: 'text' },
            { name: 'description', label: 'Description', type: 'textarea' },
            { name: 'website', label: 'Website URL', type: 'text' },
            { name: 'is_active', label: 'Active', type: 'boolean' },
            { name: 'return_allowed', label: 'Returns Allowed', type: 'boolean' },
            { name: 'return_window_days', label: 'Return Window Days', type: 'number' },
            { name: 'replacement_allowed', label: 'Replacement Allowed', type: 'boolean' },
            { name: 'replacement_window_days', label: 'Replacement Window Days', type: 'number' },
          ]}
          onFill={handleAIFill}
          scope="brands:write"
          context="Product brand carried by this store"
        />
        <FormGrid>
          <FormField label="Brand Name" htmlFor="name" required>
            <TextInput
              id="name"
              name="name"
              required
              value={brandName}
              onChange={e => {
                setBrandName(e.target.value)
                const slugInput = document.getElementById('slug') as HTMLInputElement
                if (slugInput && !brand) {
                  slugInput.value = generateSlug(e.target.value)
                }
              }}
              placeholder="e.g. Stanley, DeWalt"
            />
          </FormField>

          <FormField label="Slug" htmlFor="slug" required hint="URL-friendly identifier. Auto-filled from name.">
            <TextInput id="slug" name="slug" required defaultValue={brand?.slug} placeholder="e.g. stanley, dewalt" />
          </FormField>

          <FormField label="Website" htmlFor="website">
            <TextInput type="url" id="website" name="website" defaultValue={brand?.website || ''} placeholder="https://example.com" />
          </FormField>

          <FormField label="Logo">
            <ImageUrlInput
              name="logo_url"
              value={logoUrl}
              onChange={setLogoUrl}
              className={fieldInputCls}
              placeholder="https://example.com/logo.png or upload"
            />
          </FormField>

          <FormField label="Description" htmlFor="description" span={2}>
            <AIEnrichButton
              fieldLabel="Description"
              value={description}
              onChange={setDescription}
              scope="brands:write"
              context={`Brand: ${brandName}`}
              multiline
            >
              <TextArea
                id="description"
                name="description"
                rows={3}
                value={description}
                onChange={e => setDescription(e.target.value)}
                className="pr-8"
                placeholder="Enter brand description"
              />
            </AIEnrichButton>
          </FormField>

          <div className="md:col-span-2 flex items-center">
            <input type="hidden" name="is_active" value={isActive ? 'true' : ''} />
            <Toggle id="is_active" checked={isActive} onChange={setIsActive} label="Active" />
          </div>
        </FormGrid>
      </FormSection>

      {hasReturns && (
        <FormSection title="Return & Replacement Policy" description="Brand policy takes priority over category policy on the product page.">
          <FormGrid>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <input type="hidden" name="return_allowed" value={returnAllowed ? 'true' : 'false'} />
                <Toggle id="return_allowed" checked={returnAllowed} onChange={setReturnAllowed} label="Returns Allowed" />
              </div>
              {returnAllowed && (
                <FormField label="Return window (days)" htmlFor="return_window_days">
                  <NumberInput
                    id="return_window_days"
                    name="return_window_days"
                    min={1}
                    max={90}
                    value={returnDays}
                    onChange={e => setReturnDays(Math.max(1, parseInt(e.target.value) || 1))}
                  />
                </FormField>
              )}
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <input type="hidden" name="replacement_allowed" value={replacementAllowed ? 'true' : 'false'} />
                <Toggle id="replacement_allowed" checked={replacementAllowed} onChange={setReplacementAllowed} label="Replacement Allowed" />
              </div>
              {replacementAllowed && (
                <FormField label="Replacement window (days)" htmlFor="replacement_window_days">
                  <NumberInput
                    id="replacement_window_days"
                    name="replacement_window_days"
                    min={1}
                    max={90}
                    value={replacementDays}
                    onChange={e => setReplacementDays(Math.max(1, parseInt(e.target.value) || 1))}
                  />
                </FormField>
              )}
            </div>
          </FormGrid>
        </FormSection>
      )}

      <FormFooter cancelHref={ap('/admin/brands')}>
        {isDraft ? (
          <>
            <FormButton variant="secondary" name="intent" value="draft" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Save Draft'}
            </FormButton>
            <FormButton name="intent" value="publish" disabled={isSubmitting}>
              {isSubmitting ? 'Publishing…' : 'Publish'}
            </FormButton>
          </>
        ) : (
          <FormButton disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : submitLabel || (brand ? 'Update Brand' : 'Create Brand')}
          </FormButton>
        )}
      </FormFooter>
    </form>
  )
}
