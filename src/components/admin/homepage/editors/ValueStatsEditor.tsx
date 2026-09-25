'use client'

import { VALUE_STAT_METRICS, valueStatMetrics, type ValueStatMetric } from '@/lib/homepage-sections'
import { Grid, HeadingFields, LABEL_CLASS, Note, Text, useSectionBinding, type EditorProps } from './fields'

export default function ValueStatsEditor(props: EditorProps) {
  const { section, canWrite } = props
  const b = useSectionBinding(props)
  const shown = new Map(valueStatMetrics(section).map(m => [m.metric, m.label]))

  function save(next: Map<ValueStatMetric, string>) {
    b.saveConfig({
      metrics: VALUE_STAT_METRICS.filter(m => next.has(m.metric)).map(m => ({ metric: m.metric, label: next.get(m.metric) ?? '' })),
    })
  }

  function toggle(metric: ValueStatMetric, on: boolean) {
    const next = new Map(shown)
    if (on) next.set(metric, VALUE_STAT_METRICS.find(m => m.metric === metric)?.label ?? '')
    else next.delete(metric)
    save(next)
  }

  function relabel(metric: ValueStatMetric, label: string) {
    const next = new Map(shown)
    next.set(metric, label.trim() || (VALUE_STAT_METRICS.find(m => m.metric === metric)?.label ?? ''))
    save(next)
  }

  return (
    <Grid>
      <HeadingFields props={props} eyebrowHint="Small line above the heading, e.g. By the numbers." />
      <div className="sm:col-span-2 space-y-2">
        <span className={LABEL_CLASS}>Numbers to show</span>
        {VALUE_STAT_METRICS.map(m => {
          const on = shown.has(m.metric)
          return (
            <div key={m.metric} className="grid grid-cols-1 sm:grid-cols-[200px_minmax(0,1fr)] items-end gap-2 sm:gap-3">
              <label className="flex items-center gap-2 text-sm text-foreground min-h-[38px] cursor-pointer">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!canWrite}
                  onChange={e => toggle(m.metric, e.target.checked)}
                  className="accent-accent-500"
                />
                {m.label}
              </label>
              {on ? (
                <Text label="Label" value={shown.get(m.metric) ?? m.label} disabled={!canWrite} onCommit={v => relabel(m.metric, v)} />
              ) : <div />}
            </div>
          )
        })}
      </div>
      <Note>Counted live from your orders and catalogue. A number that is still zero is not shown; large numbers are rounded down, e.g. 1,234 shows as 1,200+.</Note>
    </Grid>
  )
}
