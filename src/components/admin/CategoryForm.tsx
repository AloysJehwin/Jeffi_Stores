'use client'

import { useState, useMemo, useRef } from 'react'
import Link from 'next/link'
import { ap } from '@/lib/admin-path'
import AdminSelect from './AdminSelect'
import * as Icons from 'lucide-react'
import Toggle from '@/components/ui/Toggle'
import AIEnrichButton from './AIEnrichButton'
import { RequireWrite } from '@/contexts/AdminScopesContext'

const ICON_OPTIONS = [
  'Anchor', 'Anvil', 'Aperture', 'Axe', 'Battery', 'BatteryCharging',
  'Bolt', 'Box', 'Boxes', 'Brush', 'Cable', 'CircuitBoard', 'Cog',
  'Cpu', 'Disc', 'Disc2', 'Drill', 'Filter', 'Flame', 'Flashlight',
  'FlaskConical', 'Forklift', 'Gauge', 'Grip', 'Hammer', 'Hexagon',
  'HardHat', 'Layers', 'Link', 'Link2', 'Magnet', 'Microchip',
  'Nut', 'Package', 'Paintbrush', 'PaintRoller', 'PencilRuler',
  'Pickaxe', 'Pipette', 'Plug', 'PlugZap', 'Ruler', 'Satellite',
  'ScanLine', 'Scissors', 'Settings', 'Shield', 'Shovel', 'Spade',
  'SprayCan', 'TestTube', 'Thermometer', 'ToolCase', 'Toolbox',
  'Truck', 'Warehouse', 'Weight', 'Wind', 'Wrench', 'Zap',
]

interface Category {
  id: string
  name: string
  parent_category_id: string | null
  return_allowed?: boolean | null
  return_window_days?: number | null
  replacement_allowed?: boolean | null
  replacement_window_days?: number | null
}

interface CategoryFormProps {
  categories: Category[]
  action: (formData: FormData) => Promise<void>
  category?: any
  backUrl?: string
  isDraft?: boolean
  submitLabel?: string
}

function IconPreview({ name, className }: { name: string; className?: string }) {
  const Icon = (Icons as any)[name] as React.FC<{ className?: string }> | undefined
  if (!Icon) return <Icons.Package className={className} />
  return <Icon className={className} />
}

const NAME_MAP: Record<string, string> = {
  bolt: 'Bolt', bolts: 'Bolt',
  screw: 'Cog', screws: 'Cog', screwdriver: 'Wrench',
  nut: 'Nut', nuts: 'Nut',
  washer: 'Disc', washers: 'Disc',
  drill: 'Drill',
  hammer: 'Hammer', hammers: 'Hammer',
  wrench: 'Wrench', wrenches: 'Wrench', torque: 'Wrench', adjustable: 'Wrench',
  plier: 'Grip', pliers: 'Grip',
  socket: 'Hexagon', sockets: 'Hexagon',
  hand: 'Toolbox',
  measuring: 'Ruler', measure: 'Ruler', gauge: 'Gauge', meter: 'Gauge',
  cutting: 'Scissors', blade: 'Scissors', saw: 'Scissors', cutter: 'Scissors',
  abrasive: 'ScanLine', abrasives: 'ScanLine', grinding: 'ScanLine', sandpaper: 'ScanLine',
  welding: 'Flame', weld: 'Flame', aluminum: 'Flame',
  belt: 'Link', belts: 'Link',
  chain: 'Link2', chains: 'Link2',
  coupling: 'Boxes', couplings: 'Boxes',
  threaded: 'Anchor', rod: 'Anchor', rods: 'Anchor', anchor: 'Anchor', anchors: 'Anchor',
  hose: 'Waves', clamp: 'Waves', clamps: 'Waves', clip: 'Waves',
  crimping: 'Zap', terminal: 'Zap', terminals: 'Zap', cable: 'Cable', wire: 'Cable', electrical: 'PlugZap', electric: 'PlugZap',
  bearing: 'Aperture', bearings: 'Aperture',
  pulley: 'Disc', wheel: 'Disc', wheels: 'Disc',
  transmission: 'Cog', drive: 'Cog',
  fastener: 'Bolt', fasteners: 'Bolt',
  safety: 'Shield', protective: 'Shield', protection: 'Shield',
  lubricant: 'FlaskConical', lubricants: 'FlaskConical', chemical: 'FlaskConical', chemicals: 'FlaskConical', oil: 'FlaskConical', grease: 'FlaskConical',
  handling: 'Truck', lifting: 'Truck', trolley: 'Truck',
  pipe: 'Filter', pipes: 'Filter', plumbing: 'Filter', valve: 'Filter', valves: 'Filter', fitting: 'Filter', fittings: 'Filter',
  motor: 'Cpu', motors: 'Cpu', engine: 'Cpu', pneumatic: 'Cpu', hydraulic: 'Cpu', cylinder: 'Cpu',
  paint: 'Paintbrush', coating: 'PaintRoller', brush: 'Paintbrush',
  spring: 'Magnet', springs: 'Magnet', coil: 'Magnet',
  tool: 'Wrench', tools: 'Wrench', equipment: 'Toolbox',
  industrial: 'Factory', component: 'Boxes', components: 'Boxes',
}

function resolveIconByName(name: string): string {
  const lower = name.toLowerCase()
  const words = lower.split(/[\s\-_&]+/)
  for (const word of words) {
    if (NAME_MAP[word]) return NAME_MAP[word]
  }
  for (const [key, val] of Object.entries(NAME_MAP)) {
    if (lower.includes(key)) return val
  }
  return 'Package'
}

export default function CategoryForm({ categories, action, category, backUrl, isDraft = false, submitLabel }: CategoryFormProps) {
  const isSubcat = !!category?.parent_category_id
  const isCurrentlyInherited = isSubcat && category?.return_allowed == null

  const parentCat = isSubcat
    ? categories.find(c => c.id === category.parent_category_id) ?? null
    : null

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedIcon, setSelectedIcon] = useState<string>(category?.icon_name || resolveIconByName(category?.name || ''))
  const [iconSearch, setIconSearch] = useState('')
  const [showPicker, setShowPicker] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [isActive, setIsActive] = useState<boolean>(category?.is_active ?? true)
  const [overriding, setOverriding] = useState(!isCurrentlyInherited)
  const [categoryName, setCategoryName] = useState<string>(category?.name || '')
  const [description, setDescription] = useState<string>(category?.description || '')
  const [returnAllowed, setReturnAllowed] = useState<boolean>(
    category?.return_allowed ?? parentCat?.return_allowed ?? true
  )
  const [returnDays, setReturnDays] = useState<number>(
    category?.return_window_days ?? parentCat?.return_window_days ?? 7
  )
  const [replacementAllowed, setReplacementAllowed] = useState<boolean>(
    category?.replacement_allowed ?? parentCat?.replacement_allowed ?? true
  )
  const [replacementDays, setReplacementDays] = useState<number>(
    category?.replacement_window_days ?? parentCat?.replacement_window_days ?? 7
  )
  const nameRef = useRef<HTMLInputElement>(null)

  const mainCategories = categories.filter(c => !c.parent_category_id)

  const filteredIcons = useMemo(() =>
    ICON_OPTIONS.filter(n => n.toLowerCase().includes(iconSearch.toLowerCase())),
    [iconSearch]
  )

  async function handleGenerate() {
    const name = nameRef.current?.value?.trim()
    if (!name) return
    setGenerating(true)
    try {
      const res = await fetch('/api/admin/categories/suggest-icon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json() as { iconName?: string }
      if (data.iconName) setSelectedIcon(data.iconName)
    } finally {
      setGenerating(false)
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)
    try {
      const formData = new FormData(e.currentTarget)
      await action(formData)
    } catch (err: any) {
      if (err?.digest?.startsWith('NEXT_REDIRECT')) throw err
      setError('Failed to save category. Please try again.')
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-surface-elevated rounded-lg shadow-sm border border-border-default">
      {backUrl && <input type="hidden" name="_back" value={backUrl} />}
      <div className="p-4 sm:p-6">
        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-red-800 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          <div className="md:col-span-2">
            <label htmlFor="name" className="block text-sm font-medium text-foreground-secondary mb-2">
              Category Name *
            </label>
            <input
              ref={nameRef}
              type="text"
              id="name"
              name="name"
              required
              value={categoryName}
              onChange={e => setCategoryName(e.target.value)}
              className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="Enter category name"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-foreground-secondary mb-2">
              Category Icon
            </label>

            <input type="hidden" name="icon_name" value={selectedIcon} />

            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-lg bg-accent-100 dark:bg-accent-900/30 flex items-center justify-center border-2 border-accent-300 dark:border-accent-700 shrink-0">
                <IconPreview name={selectedIcon} className="w-7 h-7 text-accent-600 dark:text-accent-400" />
              </div>
              <div className="flex flex-col gap-1.5">
                <p className="text-sm font-semibold text-foreground">{selectedIcon}</p>
                <div className="flex items-center gap-2">
                  <RequireWrite scope="categories:write">
                    <button
                      type="button"
                      onClick={handleGenerate}
                      disabled={generating}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-accent-500 hover:bg-accent-600 text-white rounded-md transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {generating ? (
                        <>
                          <Icons.Loader2 className="w-3 h-3 animate-spin" />
                          Generating…
                        </>
                      ) : (
                        <>
                          <Icons.Sparkles className="w-3 h-3" />
                          Generate with AI
                        </>
                      )}
                    </button>
                  </RequireWrite>
                  <button
                    type="button"
                    onClick={() => setShowPicker(v => !v)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-border-secondary text-foreground-secondary hover:bg-surface-secondary rounded-md transition-colors"
                  >
                    <Icons.Grid2x2 className="w-3 h-3" />
                    {showPicker ? 'Close' : 'Browse'}
                  </button>
                </div>
              </div>
            </div>

            {showPicker && (
              <div className="mt-3 border border-border-secondary rounded-lg bg-surface p-3">
                <input
                  type="text"
                  placeholder="Search icons…"
                  value={iconSearch}
                  onChange={e => setIconSearch(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm border border-border-secondary rounded-md bg-surface-elevated text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent mb-3"
                />
                <div className="grid grid-cols-8 sm:grid-cols-12 gap-1.5 max-h-52 overflow-y-auto">
                  {filteredIcons.map(name => (
                    <button
                      key={name}
                      type="button"
                      title={name}
                      onClick={() => { setSelectedIcon(name); setShowPicker(false); setIconSearch('') }}
                      className={`p-2 rounded-md flex items-center justify-center transition-colors ${
                        selectedIcon === name
                          ? 'bg-accent-500 text-white'
                          : 'hover:bg-surface-secondary text-foreground-muted hover:text-foreground'
                      }`}
                    >
                      <IconPreview name={name} className="w-5 h-5" />
                    </button>
                  ))}
                  {filteredIcons.length === 0 && (
                    <p className="col-span-12 text-xs text-foreground-muted text-center py-4">No icons match</p>
                  )}
                </div>
              </div>
            )}
          </div>

          <AdminSelect
            id="parent_id"
            name="parent_id"
            label="Parent Category"
            defaultValue={category?.parent_category_id || ''}
            hint="Leave empty to create a main category"
            placeholder="None (Main Category)"
            options={[
              { value: '', label: 'None (Main Category)' },
              ...mainCategories.map(cat => ({
                value: cat.id,
                label: cat.name,
              })),
            ]}
          />

          <div>
            <label htmlFor="display_order" className="block text-sm font-medium text-foreground-secondary mb-2">
              Display Order *
            </label>
            <input
              type="number"
              id="display_order"
              name="display_order"
              required
              min="0"
              defaultValue={category?.display_order || 0}
              className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="0"
            />
            <p className="text-xs text-foreground-muted mt-1">Lower numbers appear first</p>
          </div>

          <div>
            <label htmlFor="sku_prefix" className="block text-sm font-medium text-foreground-secondary mb-2">
              SKU Prefix
            </label>
            <input
              type="text"
              id="sku_prefix"
              name="sku_prefix"
              maxLength={10}
              defaultValue={category?.sku_prefix || ''}
              className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent uppercase"
              placeholder="e.g. BOLT, NUT, WSH"
            />
            <p className="text-xs text-foreground-muted mt-1">
              Used for auto-generating product SKUs (e.g. BOLT-001). If empty, first 3 letters of name are used.
            </p>
          </div>

          <div className="md:col-span-2">
            <label htmlFor="google_product_category" className="block text-sm font-medium text-foreground-secondary mb-2">
              Google Product Category
            </label>
            <input
              type="text"
              id="google_product_category"
              name="google_product_category"
              defaultValue={category?.google_product_category || ''}
              className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="e.g., Hardware > Fasteners > Bolts"
            />
            <p className="text-xs text-foreground-muted mt-1">
              Google taxonomy path or ID for Merchant Center.{' '}
              <a href="https://www.google.com/basepages/producttype/taxonomy-with-ids.en-US.txt" target="_blank" rel="noopener noreferrer" className="text-accent-500 underline">
                Google Product Taxonomy
              </a>
            </p>
          </div>

          <div className="md:col-span-2">
            <label htmlFor="description" className="block text-sm font-medium text-foreground-secondary mb-2">
              Description
            </label>
            <AIEnrichButton
              fieldLabel="Description"
              value={description}
              onChange={setDescription}
              context={`Category: ${categoryName}`}
              multiline
            >
              <textarea
                id="description"
                name="description"
                rows={3}
                value={description}
                onChange={e => setDescription(e.target.value)}
                className="w-full px-4 py-2 pr-8 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:ring-2 focus:ring-accent-500 focus:border-transparent"
                placeholder="Enter category description"
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
        <h2 className="text-base font-semibold text-foreground mb-1">Return &amp; Replacement Policy</h2>
        <p className="text-xs text-foreground-muted mb-4">Category policy is the default. Brand policy can override per product.</p>

        <input type="hidden" name="policy_override" value={overriding ? 'true' : 'false'} />

        {isSubcat && !overriding ? (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="inline-flex items-center gap-1.5 text-sm bg-surface-secondary border border-border-secondary text-foreground-secondary px-3 py-1.5 rounded-full">
              <svg className="w-3.5 h-3.5 text-accent-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Inherited from {parentCat?.name ?? 'parent category'}
              {' — '}
              {(parentCat?.return_allowed ?? true) ? `Returns ${parentCat?.return_window_days ?? 7}d` : 'No returns'}
              {' · '}
              {(parentCat?.replacement_allowed ?? true) ? `Replacement ${parentCat?.replacement_window_days ?? 7}d` : 'No replacement'}
            </span>
            <button
              type="button"
              onClick={() => setOverriding(true)}
              className="text-sm text-accent-500 hover:text-accent-600 font-medium underline underline-offset-2"
            >
              Override for this subcategory
            </button>
          </div>
        ) : (
          <>
            {isSubcat && (
              <button
                type="button"
                onClick={() => setOverriding(false)}
                className="text-xs text-foreground-muted hover:text-foreground underline underline-offset-2 mb-4 block"
              >
                Reset to inherited (use parent policy)
              </button>
            )}
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
          </>
        )}
      </div>

      <div className="px-4 sm:px-6 py-4 bg-surface-secondary border-t border-border-default flex justify-end gap-4">
        <Link
          href={ap('/admin/categories')}
          className="px-6 py-2 border border-border-secondary rounded-lg text-foreground-secondary hover:bg-surface-secondary transition-colors"
        >
          Cancel
        </Link>
        {isDraft ? (
          <RequireWrite scope="categories:write">
            <button type="submit" name="intent" value="draft" disabled={isSubmitting}
              className="px-6 py-2 bg-surface border border-border-secondary hover:bg-surface-secondary text-foreground rounded-lg font-semibold transition-colors disabled:opacity-50">
              {isSubmitting ? 'Saving…' : 'Save Draft'}
            </button>
            <button type="submit" name="intent" value="publish" disabled={isSubmitting}
              className="px-6 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold transition-colors disabled:opacity-50">
              {isSubmitting ? 'Publishing…' : 'Publish'}
            </button>
          </RequireWrite>
        ) : (
          <RequireWrite scope="categories:write">
            <button type="submit" disabled={isSubmitting}
              className="px-6 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {isSubmitting ? 'Saving…' : submitLabel || (category ? 'Update Category' : 'Create Category')}
            </button>
          </RequireWrite>
        )}
      </div>
    </form>
  )
}
