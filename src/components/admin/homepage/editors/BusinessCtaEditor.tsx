'use client'

import { CtaFields, Grid, Text, TextArea, copyHint, sectionCopy, useSectionBinding, type EditorProps } from './fields'

export default function BusinessCtaEditor(props: EditorProps) {
  const { section, canWrite } = props
  const b = useSectionBinding(props)
  const d = sectionCopy(props)
  return (
    <Grid>
      <Text
        label="Heading"
        value={section.title ?? d.title ?? ''}
        disabled={!canWrite}
        hint={copyHint(section.title == null && !!d.title)}
        onCommit={b.title}
      />
      <TextArea
        label="Subtitle"
        value={section.subtitle ?? d.subtitle ?? ''}
        disabled={!canWrite}
        hint={copyHint(section.subtitle == null && !!d.subtitle, 'Pitch the bulk or B2B experience in a line or two.')}
        onCommit={b.subtitle}
      />
      <CtaFields
        props={props}
        urlPlaceholder="Business signup page"
        hint="Leave empty to use your business signup page."
      />
    </Grid>
  )
}
