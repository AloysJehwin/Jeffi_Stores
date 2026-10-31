'use client'

import { Grid, Note, Text, copyHint, sectionCopy, useSectionBinding, type EditorProps } from './fields'

export default function FeaturedForYouEditor(props: EditorProps) {
  const { section, canWrite } = props
  const b = useSectionBinding(props)
  const d = sectionCopy(props)

  return (
    <Grid>
      <Note>
        These picks are personalised per shopper from their browsing and order history, so there is nothing to
        configure. The section is hidden entirely for signed-out visitors.
      </Note>
      <Text
        label="Heading"
        value={section.title ?? d.title ?? ''}
        disabled={!canWrite}
        hint={copyHint(section.title == null && !!d.title)}
        onCommit={b.title}
      />
    </Grid>
  )
}
