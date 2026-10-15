'use client'

import { useState } from 'react'
import AdminSelect from '@/components/admin/AdminSelect'
import { DURATION_UNITS, UNIT_LABEL, fromMinutes, toMinutes, pickDisplayUnit, type DurationUnit } from '@/lib/campaigns/duration'

// A duration override: a number input plus a unit dropdown (min/hr/day/week/month/year).
// The stored value is always canonical MINUTES; the dropdown only changes how it is entered/shown.
export default function DurationField({
  canonicalMinutes,
  defaultMinutes,
  recommendedUnit,
  allowedUnits,
  min,
  max,
  onChange,
}: {
  canonicalMinutes: number | undefined
  defaultMinutes: number | undefined
  recommendedUnit: DurationUnit
  allowedUnits?: DurationUnit[]
  min?: number
  max?: number
  onChange: (minutes: number | undefined) => void
}) {
  const units = allowedUnits && allowedUnits.length ? allowedUnits : DURATION_UNITS
  const isOverridden = canonicalMinutes !== undefined && canonicalMinutes !== null
  const initialUnit =
    isOverridden && typeof canonicalMinutes === 'number'
      ? pickDisplayUnit(canonicalMinutes, recommendedUnit)
      : recommendedUnit
  const [unit, setUnit] = useState<DurationUnit>(initialUnit)
  const displayValue =
    isOverridden && typeof canonicalMinutes === 'number' ? String(fromMinutes(canonicalMinutes, unit)) : ''
  const minInUnit = typeof min === 'number' ? fromMinutes(min, unit) : undefined
  const maxInUnit = typeof max === 'number' ? fromMinutes(max, unit) : undefined
  const defaultInUnit =
    typeof defaultMinutes === 'number' ? fromMinutes(defaultMinutes, recommendedUnit) : undefined
  return (
    <div>
      <div className="flex gap-2">
        <input
          type="number"
          value={displayValue}
          placeholder={
            defaultInUnit !== undefined ? `Default: ${defaultInUnit} ${UNIT_LABEL[recommendedUnit]}` : 'Default'
          }
          onChange={e => {
            const raw = e.target.value
            if (raw === '') return onChange(undefined)
            const parsed = parseFloat(raw)
            if (!Number.isFinite(parsed) || parsed <= 0) return onChange(undefined)
            onChange(toMinutes(parsed, unit))
          }}
          className="field-normal w-full border border-border-secondary bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
        />
        <AdminSelect
          value={unit}
          onChange={v => setUnit(v as DurationUnit)}
          options={units.map(u => ({ value: u, label: UNIT_LABEL[u] }))}
          className="w-28 shrink-0"
        />
      </div>
      <p className="text-[10px] text-foreground-muted mt-0.5">
        Recommended: {UNIT_LABEL[recommendedUnit]}
        {minInUnit !== undefined || maxInUnit !== undefined
          ? ` · Range: ${minInUnit ?? '-∞'} to ${maxInUnit ?? '∞'} ${UNIT_LABEL[unit]}`
          : ''}
      </p>
    </div>
  )
}
