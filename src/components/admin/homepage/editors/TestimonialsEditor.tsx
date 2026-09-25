'use client'

import { configNumber } from '@/lib/homepage-sections'
import { Grid, HeadingFields, LayoutField, LimitField, Note, Select, useSectionBinding, type EditorProps } from './fields'

const RATINGS = [
  { value: '5', label: '5 stars only' },
  { value: '4', label: '4 stars and up' },
  { value: '3', label: '3 stars and up' },
  { value: '1', label: 'Any rating' },
]

export default function TestimonialsEditor(props: EditorProps) {
  const { section, canWrite } = props
  const b = useSectionBinding(props)
  const approved = props.options?.counts.approvedReviews

  return (
    <Grid>
      <HeadingFields props={props} eyebrowHint="Small line above the heading, e.g. Customer reviews." />
      <LimitField props={props} label="How many reviews" hint="Approved reviews with written feedback, highest rated first." />
      <Select
        label="Minimum rating"
        value={String(configNumber(section, 'minRating', 4, 5))}
        options={RATINGS}
        disabled={!canWrite}
        onChange={v => b.saveConfig({ minRating: Number(v) })}
      />
      <LayoutField props={props} />
      {approved === 0 && (
        <Note>There are no approved reviews yet, so this section stays hidden. Approve reviews under Reviews to fill it.</Note>
      )}
    </Grid>
  )
}
