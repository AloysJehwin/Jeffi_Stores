'use client'

import { configNumber, productSource } from '@/lib/homepage-sections'
import {
  CtaFields, Grid, HeadingFields, LayoutField, LimitField, Note, NumberField, Select, ToggleField,
  useSectionBinding, type EditorProps, type SectionOptions,
} from './fields'

const SOURCES = [
  { value: 'featured', label: 'Featured products' },
  { value: 'new_arrivals', label: 'New arrivals' },
  { value: 'best_sellers', label: 'Best sellers' },
  { value: 'on_sale', label: 'On sale' },
  { value: 'category', label: 'One category' },
]

const SOURCE_HINTS: Record<string, string> = {
  featured: 'Products you have flagged as featured in the catalogue.',
  new_arrivals: 'Newest products first.',
  best_sellers: 'Ranked by units sold.',
  on_sale: 'Products with an active discount.',
  category: 'Every product in the category below.',
}

function sourceHint(source: string, options?: SectionOptions): string {
  const base = SOURCE_HINTS[source]
  const counts = options?.counts
  if (!counts) return base
  const available: Record<string, number | undefined> = {
    featured: counts.featured,
    new_arrivals: counts.newArrivals,
    best_sellers: counts.bestSellers,
    on_sale: counts.onSale,
  }
  const n = available[source]
  return n === undefined ? base : `${base} ${n} available.`
}

export default function ProductRowEditor(props: EditorProps) {
  const { section, canWrite } = props
  const b = useSectionBinding(props)
  const source = productSource(section)

  return (
    <Grid>
      <Select
        label="Products"
        value={source}
        options={SOURCES}
        disabled={!canWrite}
        hint={sourceHint(source, props.options)}
        onChange={v => b.saveConfig({ source: v })}
      />

      {source === 'category' ? (
        <Select
          label="Category"
          value={b.str('categorySlug')}
          options={props.options?.categories ?? []}
          placeholder="Choose a category"
          disabled={!canWrite}
          onChange={v => b.saveConfig({ categorySlug: v || null })}
        />
      ) : <div />}

      <LimitField props={props} />
      <LayoutField props={props} />

      <ToggleField
        label="Just Landed badge"
        checked={section.config?.justLanded === true}
        disabled={!canWrite}
        hint="Marks recently launched products with a New badge. Uses the launch date, else the date added."
        onChange={v => b.saveConfig({ justLanded: v })}
      />
      {section.config?.justLanded === true ? (
        <NumberField
          label="Counts as new for (days)"
          value={configNumber(section, 'newWithinDays', 30, 365)}
          disabled={!canWrite}
          onCommit={v => b.saveConfig({ newWithinDays: Math.min(v, 365) })}
        />
      ) : <div />}

      <HeadingFields props={props} eyebrowHint="Small line above the heading, e.g. Handpicked." />
      <CtaFields props={props} />

      {source === 'category' && !b.str('categorySlug') && (
        <Note>Pick a category slug — without one this row falls back to featured products.</Note>
      )}
    </Grid>
  )
}
