'use client'

import { CtaFields, Grid, HeadingFields, LayoutField, LimitField, type EditorProps } from './fields'

export default function CategoryShowcaseEditor(props: EditorProps) {
  return (
    <Grid>
      <HeadingFields props={props} eyebrowHint="Small line above the heading, e.g. Explore." />
      <LimitField props={props} label="How many categories" hint="Large cards — four or fewer reads best." />
      <LayoutField props={props} />
      <CtaFields props={props} hint="Usually /categories." />
    </Grid>
  )
}
