'use client'

import { Grid, Note, Text, useSectionBinding, type EditorProps } from './fields'

export default function FeaturedForYouEditor(props: EditorProps) {
  const { section, canWrite } = props
  const b = useSectionBinding(props)

  return (
    <Grid>
      <Note>
        These picks are personalised per shopper from their browsing and order history, so there is nothing to
        configure. The section is hidden entirely for signed-out visitors.
      </Note>
      <Text
        label="Heading"
        value={section.title ?? ''}
        disabled={!canWrite}
        placeholder="Featured for you"
        hint="Optional — overrides the default heading."
        onCommit={b.title}
      />
    </Grid>
  )
}
