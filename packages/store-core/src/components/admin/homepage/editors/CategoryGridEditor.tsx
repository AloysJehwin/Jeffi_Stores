'use client'

import { CtaFields, Grid, HeadingFields, LayoutField, LimitField, type EditorProps } from './fields'

export default function CategoryGridEditor(props: EditorProps) {
  return (
    <Grid>
      <HeadingFields props={props} eyebrowHint="Small line above the heading, e.g. Browse." />
      <LimitField props={props} label="How many categories" hint="Top-level categories, ordered by the catalogue." />
      <LayoutField props={props} />
      <CtaFields props={props} hint="Usually /categories." />
    </Grid>
  )
}
