'use client'

import { useState } from 'react'
import Link from 'next/link'
import Toggle from '@/components/ui/Toggle'
import AIEnrichButton from './AIEnrichButton'

interface BrandFormProps {
  action: (formData: FormData) => Promise<void>
  brand?: any
}

export default function BrandForm({ action, brand }: BrandFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [brandName, setBrandName] = useState<string>(brand?.name || '')
  const [description, setDescription] = useState<string>(brand?.description || '')
  const [isActive, setIsActive] = useState<boolean>(brand?.is_active ?? true)
  const [returnAllowed, setReturnAllowed] = useState<boolean>(brand?.return_allowed ?? true)
  const [returnDays, setReturnDays] = useState<number>(brand?.return_window_days ?? 7)
  const [replacementAllowed, setReplacementAllowed] = useState<boolean>(brand?.replacement_allowed ?? true)
  const [replacementDays, setReplacementDays] = useState<number>(brand?.replacement_window_days ?? 7)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)

    try {
      const formData = new FormData(e.currentTarget)
      await action(formData)
    } catch (err: any) {
      if (err?.digest?.startsWith('NEXT_REDIRECT')) throw err
      setError('Failed to save brand. Please try again.')
      setIsSubmitting(false)
    }
  }

  function generateSlug(name: string) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  }

  return (
    <form onSubmit={handleSubmit} className="bg-surface-elevated rounded-lg shadow-sm border border-border-default">
      <div className="p-4 sm:p-6">
        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-red-800 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-foreground-secondary mb-2">
              Brand Name *
            </label>
            <input
              type="text"
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
              className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="e.g. Stanley, DeWalt"
            />
          </div>

          <div>
            <label htmlFor="slug" className="block text-sm font-medium text-foreground-secondary mb-2">
              Slug *
            </label>
            <input
              type="text"
              id="slug"
              name="slug"
              required
              defaultValue={brand?.slug}
              className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="e.g. stanley, dewalt"
            />
            <p className="text-xs text-foreground-muted mt-1">URL-friendly identifier. Auto-filled from name.</p>
          </div>

          <div>
            <label htmlFor="website" className="block text-sm font-medium text-foreground-secondary mb-2">
              Website
            </label>
            <input
              type="url"
              id="website"
              name="website"
              defaultValue={brand?.website || ''}
              className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="https://example.com"
            />
          </div>

          <div>
            <label htmlFor="logo_url" className="block text-sm font-medium text-foreground-secondary mb-2">
              Logo URL
            </label>
            <input
              type="url"
              id="logo_url"
              name="logo_url"
              defaultValue={brand?.logo_url || ''}
              className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="https://example.com/logo.png"
            />
          </div>

          <div className="md:col-span-2">
            <label htmlFor="description" className="block text-sm font-medium text-foreground-secondary mb-2">
              Description
            </label>
            <AIEnrichButton
              fieldLabel="Description"
              value={description}
              onChange={setDescription}
              context={`Brand: ${brandName}`}
              multiline
            >
              <textarea
                id="description"
                name="description"
                rows={3}
                value={description}
                onChange={e => setDescription(e.target.value)}
                className="w-full px-4 py-2 pr-8 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
                placeholder="Enter brand description"
              />
            </AIEnrichButton>
          </div>

          <div className="md:col-span-2">
            <div className="flex items-center">
              <input type="hidden" name="is_active" value={isActive ? 'true' : ''} />
              <Toggle id="is_active" checked={isActive} onChange={setIsActive} label="Active" />
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-6 py-5 border-t border-border-default">
        <h2 className="text-base font-semibold text-foreground mb-4">Return &amp; Replacement Policy</h2>
        <p className="text-xs text-foreground-muted mb-4">Brand policy takes priority over category policy on the product page.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <input type="hidden" name="return_allowed" value={returnAllowed ? 'true' : 'false'} />
              <Toggle id="return_allowed" checked={returnAllowed} onChange={setReturnAllowed} label="Returns Allowed" />
            </div>
            {returnAllowed && (
              <div>
                <label htmlFor="return_window_days" className="block text-sm font-medium text-foreground-secondary mb-1">
                  Return window (days)
                </label>
                <input
                  type="number"
                  id="return_window_days"
                  name="return_window_days"
                  min={1}
                  max={90}
                  value={returnDays}
                  onChange={e => setReturnDays(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent"
                />
              </div>
            )}
          </div>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <input type="hidden" name="replacement_allowed" value={replacementAllowed ? 'true' : 'false'} />
              <Toggle id="replacement_allowed" checked={replacementAllowed} onChange={setReplacementAllowed} label="Replacement Allowed" />
            </div>
            {replacementAllowed && (
              <div>
                <label htmlFor="replacement_window_days" className="block text-sm font-medium text-foreground-secondary mb-1">
                  Replacement window (days)
                </label>
                <input
                  type="number"
                  id="replacement_window_days"
                  name="replacement_window_days"
                  min={1}
                  max={90}
                  value={replacementDays}
                  onChange={e => setReplacementDays(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground focus:ring-2 focus:ring-accent-500 focus:border-transparent"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-6 py-4 bg-surface-secondary border-t border-border-default flex justify-end gap-4">
        <Link
          href="/admin/brands"
          className="px-6 py-2 border border-border-secondary rounded-lg text-foreground-secondary hover:bg-surface-secondary transition-colors"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-6 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? 'Saving...' : brand ? 'Update Brand' : 'Create Brand'}
        </button>
      </div>
    </form>
  )
}
