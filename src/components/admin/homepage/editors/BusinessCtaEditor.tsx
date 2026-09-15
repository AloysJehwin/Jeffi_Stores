'use client'

import { CtaFields, Grid, Text, TextArea, useSectionBinding, type EditorProps } from './fields'

export default function BusinessCtaEditor(props: EditorProps) {
  const { section, canWrite } = props
  const b = useSectionBinding(props)

  return (
    <Grid>
      <Text label="Heading" value={section.title ?? ''} disabled={!canWrite} onCommit={b.title} />
      <TextArea
        label="Subtitle"
        value={section.subtitle ?? ''}
        disabled={!canWrite}
        hint="Pitch the bulk or B2B experience in a line or two."
        onCommit={b.subtitle}
      />
      <CtaFields props={props} hint="Usually /business." />
    </Grid>
  )
}
