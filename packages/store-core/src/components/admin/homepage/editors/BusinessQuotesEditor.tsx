'use client'

import {
  Grid,
  HeadingFields,
  NumberField,
  Text,
  TextArea,
  copyHint,
  sectionCopy,
  useSectionBinding,
  type EditorProps,
} from './fields'

export default function BusinessQuotesEditor(props: EditorProps) {
  const { section, canWrite } = props
  const b = useSectionBinding(props)
  const d = sectionCopy(props)

  return (
    <Grid>
      <HeadingFields props={props} eyebrowHint="Small line above the heading, e.g. Quotes." />
      <TextArea
        label="Subtitle"
        value={section.subtitle ?? d.subtitle ?? ''}
        disabled={!canWrite}
        hint={copyHint(section.subtitle == null && !!d.subtitle)}
        onCommit={b.subtitle}
      />
      <Text
        label="Button label"
        value={section.cta_label ?? d.ctaLabel ?? ''}
        disabled={!canWrite}
        placeholder="Request a quote"
        hint={copyHint(section.cta_label == null && !!d.ctaLabel, 'Opens the quote request form.')}
        maxLength={100}
        onCommit={b.ctaLabel}
      />
      <NumberField
        label="Open quotes listed"
        value={Math.min(b.limit, 10)}
        disabled={!canWrite}
        hint="Up to 10, newest first. A business with none, and signed-out visitors, see only the request button."
        onCommit={v => b.saveConfig({ limit: Math.min(v, 10) })}
      />
    </Grid>
  )
}
