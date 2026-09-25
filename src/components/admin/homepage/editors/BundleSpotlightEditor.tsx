'use client'

import { configIds } from '@/lib/homepage-sections'
import { CtaFields, Grid, HeadingFields, LayoutField, LimitField, Note, useSectionBinding, type EditorProps } from './fields'
import ProductPickerField from './ProductPickerField'

export default function BundleSpotlightEditor(props: EditorProps) {
  const { section, canWrite } = props
  const b = useSectionBinding(props)
  const picked = configIds(section, 'productIds')
  const bundles = props.options?.counts.bundles

  return (
    <Grid>
      <HeadingFields props={props} eyebrowHint="Small line above the heading, e.g. Better together." />
      <LimitField props={props} label="How many products" hint="Each card shows its saving against MRP." />
      <LayoutField props={props} />
      <div />
      <ProductPickerField
        label="Pick products (optional)"
        ids={picked}
        multiple
        disabled={!canWrite}
        hint={`Leave empty to show every product marked as a bundle${bundles === undefined ? '' : ` (${bundles} live)`}.`}
        onCommit={ids => b.saveConfig({ productIds: ids })}
      />
      <CtaFields props={props} hint="Optional. Leave the link empty to hide the button." />
      {picked.length === 0 && bundles === 0 && (
        <Note>No live products are marked as bundles yet. Mark some in the product editor, or pick products above.</Note>
      )}
    </Grid>
  )
}
