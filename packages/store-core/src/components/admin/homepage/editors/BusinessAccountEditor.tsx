'use client'

import { BUSINESS_ACCOUNT_TILES, businessAccountConfig, type BusinessAccountTile } from '@/lib/catalog/homepage-sections'
import { Grid, HeadingFields, LABEL_CLASS, Text, VisitorField, useSectionBinding, type EditorProps } from './fields'

const TILE_LABELS: Record<BusinessAccountTile, string> = {
  orders: 'Recent orders',
  payments: 'Payments due',
  quotes: 'Open quotes',
}

const CONTACT_FIELDS = [
  { key: 'name', label: 'Name', placeholder: 'Your account manager' },
  { key: 'phone', label: 'Phone', placeholder: '+91 98765 43210' },
  { key: 'email', label: 'Email', placeholder: 'sales@example.com' },
] as const

export default function BusinessAccountEditor(props: EditorProps) {
  const { section, canWrite } = props
  const b = useSectionBinding(props)
  const { tiles } = businessAccountConfig(section)
  const contact = (section.config?.contact ?? {}) as Record<string, unknown>

  const toggle = (tile: BusinessAccountTile) => {
    const next = tiles.includes(tile) ? tiles.filter(t => t !== tile) : [...tiles, tile]
    b.saveConfig({ tiles: BUSINESS_ACCOUNT_TILES.filter(t => next.includes(t)) })
  }

  return (
    <Grid>
      <HeadingFields props={props} eyebrowHint="Small line above the heading, e.g. Your account." />

      <div className="sm:col-span-2">
        <span className={LABEL_CLASS}>Show</span>
        <p className="text-[11px] text-foreground-muted mb-2">The company name is always shown.</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
          {BUSINESS_ACCOUNT_TILES.map(tile => (
            <label
              key={tile}
              className="flex items-center gap-2 rounded-lg border border-border-default px-2.5 py-1.5 text-sm text-foreground cursor-pointer"
            >
              <input
                type="checkbox"
                checked={tiles.includes(tile)}
                disabled={!canWrite}
                onChange={() => toggle(tile)}
                className="accent-accent-500"
              />
              <span className="flex-1 truncate">{TILE_LABELS[tile]}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="sm:col-span-2">
        <p className="text-xs font-semibold text-foreground">Sales contact</p>
        <p className="text-[11px] text-foreground-muted">Who businesses can call or email. Leave empty to hide it.</p>
      </div>
      {CONTACT_FIELDS.map(f => (
        <Text
          key={f.key}
          label={f.label}
          value={typeof contact[f.key] === 'string' ? (contact[f.key] as string) : ''}
          disabled={!canWrite}
          placeholder={f.placeholder}
          ai={false}
          maxLength={f.key === 'phone' ? 30 : 120}
          onCommit={v => b.saveConfig({ contact: { ...contact, [f.key]: v.trim() || null } })}
        />
      ))}
      <VisitorField props={props} />
    </Grid>
  )
}
