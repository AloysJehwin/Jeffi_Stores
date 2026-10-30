'use client'

import { businessOffersConfig, configIds } from '@/lib/catalog/homepage-sections'
import {
  Grid,
  HeadingFields,
  LayoutField,
  Note,
  NumberField,
  Select,
  VisitorField,
  useSectionBinding,
  type EditorProps,
} from './fields'
import ProductPickerField from './ProductPickerField'

const SOURCES = [
  { value: 'auto', label: 'Automatic' },
  { value: 'picked', label: 'Chosen products' },
]

const SOURCE_HINTS: Record<string, string> = {
  auto: 'Products in the categories each business has a discount on, biggest discount first.',
  picked: "The products you pick below, at each business's own price.",
}

export default function BusinessOffersEditor(props: EditorProps) {
  const { section, canWrite } = props
  const b = useSectionBinding(props)
  const picked = configIds(section, 'productIds')
  // What the admin chose, even before any product is picked (the storefront treats that as automatic).
  const source = section.config?.source === 'picked' ? 'picked' : 'auto'

  return (
    <Grid>
      <HeadingFields props={props} eyebrowHint="Small line above the heading, e.g. Business prices." />
      <Select
        label="Products"
        value={source}
        options={SOURCES}
        disabled={!canWrite}
        hint={SOURCE_HINTS[source]}
        onChange={v => b.saveConfig({ source: v })}
      />
      <NumberField
        label="How many products"
        value={businessOffersConfig(section).limit}
        disabled={!canWrite}
        hint="Up to 24."
        onCommit={v => b.saveConfig({ limit: Math.min(v, 24) })}
      />
      <LayoutField props={props} />
      <VisitorField props={props} />
      {source === 'picked' && (
        <ProductPickerField
          label="Products to show"
          ids={picked}
          multiple
          max={24}
          disabled={!canWrite}
          onCommit={ids => b.saveConfig({ productIds: ids })}
        />
      )}
      {source === 'picked' && picked.length === 0 && (
        <Note>Pick at least one product. Until then the section picks products automatically.</Note>
      )}
    </Grid>
  )
}
