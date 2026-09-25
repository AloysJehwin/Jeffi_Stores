'use client'

import { configNumber } from '@/lib/homepage-sections'
import {
  CtaFields, Grid, HeadingFields, LayoutField, LimitField, NumberField, useSectionBinding, type EditorProps,
} from './fields'

export default function BackInStockEditor(props: EditorProps) {
  const { section, canWrite } = props
  const b = useSectionBinding(props)

  return (
    <Grid>
      <HeadingFields props={props} eyebrowHint="Small line above the heading, e.g. Restocked." />
      <NumberField
        label="Restocked within (days)"
        value={configNumber(section, 'days', 14, 90)}
        disabled={!canWrite}
        hint="Up to 90 days. A product counts when its stock went from zero to available, or its stock status went from Out of Stock to In Stock, in this window. Ones shoppers were waiting for come first."
        onCommit={v => b.saveConfig({ days: Math.min(v, 90) })}
      />
      <LimitField props={props} label="How many products" />
      <LayoutField props={props} />
      <CtaFields props={props} hint="Optional. Leave the link empty to hide the button." />
    </Grid>
  )
}
