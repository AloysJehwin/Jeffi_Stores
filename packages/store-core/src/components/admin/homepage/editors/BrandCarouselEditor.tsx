'use client'

import { CtaFields, Grid, HeadingFields, LayoutField, LimitField, type EditorProps } from './fields'

export default function BrandCarouselEditor(props: EditorProps) {
  return (
    <Grid>
      <HeadingFields props={props} eyebrowHint="Small line above the heading, e.g. Trusted Names." />
      <LimitField props={props} label="How many brands" hint="Brands with the most products come first." />
      <LayoutField props={props} />
      <CtaFields props={props} hint="Usually /brands." />
    </Grid>
  )
}
