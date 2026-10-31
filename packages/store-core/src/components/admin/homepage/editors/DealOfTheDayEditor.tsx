'use client'

import {
  CtaFields,
  DateTimeField,
  Grid,
  HeadingFields,
  LimitField,
  Note,
  useSectionBinding,
  type EditorProps,
} from './fields'

export default function DealOfTheDayEditor(props: EditorProps) {
  const { canWrite } = props
  const b = useSectionBinding(props)
  const countdownEndsAt = b.str('countdownEndsAt')

  return (
    <Grid>
      <HeadingFields props={props} eyebrowHint="Small line above the heading, e.g. Today only." />
      <LimitField props={props} label="How many deals" hint="Discounted products, biggest saving first." />

      <DateTimeField
        label="Countdown ends"
        value={countdownEndsAt || null}
        disabled={!canWrite}
        placeholder="No countdown"
        hint="Shows a ticking timer on the storefront. Leave empty for no countdown."
        onCommit={v => b.saveConfig({ countdownEndsAt: v })}
      />

      <CtaFields props={props} hint="Usually /products?onSale=1." />

      {countdownEndsAt && Date.parse(countdownEndsAt) < Date.now() && (
        <Note>The countdown end is in the past — the timer will read as expired.</Note>
      )}
    </Grid>
  )
}
