'use client'

import { Grid, Note, Text, TextArea, useSectionBinding, type EditorProps } from './fields'

export default function AboutEditor(props: EditorProps) {
  const { section, canWrite } = props
  const b = useSectionBinding(props)

  return (
    <Grid>
      <Text label="Heading" value={section.title ?? ''} disabled={!canWrite} onCommit={b.title} />
      <TextArea
        label="Subtitle"
        value={section.subtitle ?? ''}
        disabled={!canWrite}
        hint="The store story shown beside the stats."
        onCommit={b.subtitle}
      />
      <Note>Stats in this section come from your live catalogue and order history.</Note>
    </Grid>
  )
}
