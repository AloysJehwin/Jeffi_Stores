'use client'

import { Grid, HeadingFields, LayoutField, NumberField, VisitorField, useSectionBinding, type EditorProps } from './fields'

export default function BusinessReorderEditor(props: EditorProps) {
  const b = useSectionBinding(props)

  return (
    <Grid>
      <HeadingFields props={props} eyebrowHint="Small line above the heading, e.g. Buy again." />
      <NumberField
        label="How many products"
        value={Math.min(Math.max(b.limit, 4), 12)}
        min={4}
        disabled={!props.canWrite}
        hint="4 to 12. Each business sees the products it orders most, with quick add."
        onCommit={v => b.saveConfig({ limit: Math.min(v, 12) })}
      />
      <LayoutField props={props} />
      <VisitorField props={props} />
    </Grid>
  )
}
