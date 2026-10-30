'use client'

import { configId } from '@/lib/catalog/homepage-sections'
import { Grid, HeadingFields, Note, Text, copyHint, sectionCopy, useSectionBinding, type EditorProps } from './fields'
import ProductPickerField from './ProductPickerField'
import TileListEditor from './TileListEditor'

export default function ProductSpotlightEditor(props: EditorProps) {
  const { section, canWrite } = props
  const b = useSectionBinding(props)
  const d = sectionCopy(props)
  const productId = configId(section, 'productId')
  // Raw strings, not the trimmed reader, so a freshly added blank callout stays editable.
  const callouts = (Array.isArray(b.cfg.callouts) ? b.cfg.callouts : []).filter(
    (c): c is string => typeof c === 'string'
  )

  return (
    <Grid>
      <ProductPickerField
        label="Spotlight product"
        ids={productId ? [productId] : []}
        disabled={!canWrite}
        hint="Shown large with its photo and price from the catalogue."
        onCommit={ids => b.saveConfig({ productId: ids[0] ?? null })}
      />
      <HeadingFields props={props} eyebrowHint="e.g. Spotlight" />
      <Text
        label="Headline"
        value={b.str('headline')}
        disabled={!canWrite}
        hint="Shown instead of the product name. Keep it short."
        onCommit={v => b.saveConfig({ headline: v || null })}
      />
      <Text
        label="Button label"
        value={section.cta_label ?? d.ctaLabel ?? ''}
        disabled={!canWrite}
        hint={copyHint(section.cta_label == null && !!d.ctaLabel, 'The button opens the product.')}
        onCommit={b.ctaLabel}
      />
      <TileListEditor
        label="Callouts"
        hint="Short lines that appear one by one as the visitor scrolls past, e.g. Free delivery."
        tiles={callouts.map(text => ({ text }))}
        fields={[{ key: 'text', label: 'Callout', placeholder: '2-year warranty' }]}
        blank={{ text: '' }}
        disabled={!canWrite}
        max={4}
        showIcon={false}
        itemLabel="Callout"
        onCommit={tiles => b.saveConfig({ callouts: tiles.map(t => t.text) })}
      />

      {!productId && <Note>Pick a product. The section stays hidden until one is chosen.</Note>}
    </Grid>
  )
}
