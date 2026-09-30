'use client'

import { configNumber } from '@/lib/homepage-sections'
import {
  Grid,
  LimitField,
  NumberField,
  Text,
  copyHint,
  sectionCopy,
  useSectionBinding,
  type EditorProps,
} from './fields'

export default function RecentlyViewedEditor(props: EditorProps) {
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
      <LimitField props={props} label="How many products" />
      <NumberField
        label="Show after this many views"
        value={configNumber(section, 'minItems', 2, 12)}
        disabled={!canWrite}
        hint="Hidden until a visitor has viewed at least this many products on their device."
        onCommit={v => b.saveConfig({ minItems: Math.min(v, 12) })}
      />
    </Grid>
  )
}
