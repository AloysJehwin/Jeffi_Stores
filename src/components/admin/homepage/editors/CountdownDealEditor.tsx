'use client'

import { configId } from '@/lib/homepage-sections'
import {
  DateTimeField, Grid, HeadingFields, Note, Text, copyHint, sectionCopy, useSectionBinding, type EditorProps,
} from './fields'
import ProductPickerField from './ProductPickerField'

export default function CountdownDealEditor(props: EditorProps) {
  const { section, canWrite } = props
  const b = useSectionBinding(props)
  const d = sectionCopy(props)
  const productId = configId(section, 'productId')
  const endsAt = b.str('endsAt')

  return (
    <Grid>
      <ProductPickerField
        label="Deal product"
        ids={productId ? [productId] : []}
        disabled={!canWrite}
        hint="The banner shows this product's photo, price and discount from the catalogue."
        onCommit={ids => b.saveConfig({ productId: ids[0] ?? null })}
      />
      <DateTimeField
        label="Countdown ends"
        value={endsAt || null}
        disabled={!canWrite}
        placeholder="No countdown"
        hint="Shows a live timer; the banner hides itself when it runs out."
        onCommit={v => b.saveConfig({ endsAt: v })}
      />
      <Text
        label="Button label"
        value={section.cta_label ?? d.ctaLabel ?? ''}
        disabled={!canWrite}
        hint={copyHint(section.cta_label == null && !!d.ctaLabel, 'The button opens the product.')}
        onCommit={b.ctaLabel}
      />
      <HeadingFields props={props} eyebrowHint="Small line above the heading, e.g. Limited time." />

      {!productId && <Note>Pick a product. The section stays hidden until one is chosen.</Note>}
      {endsAt && Date.parse(endsAt) < Date.now() && (
        <Note>The countdown has ended, so this banner is hidden on the storefront. Set a new end time to show it again.</Note>
      )}
    </Grid>
  )
}
