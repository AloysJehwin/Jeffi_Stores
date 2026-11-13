'use client'

import { useState } from 'react'
import type { FieldSpec } from '@/lib/catalog/entity-fields'
import Toggle from '@/components/ui/Toggle'
import AdminSelect from './AdminSelect'
import { FormField, FormGrid, NumberInput, TextArea, TextInput, fieldInputCls } from '@/components/admin/kit'

interface Props {
  specs: FieldSpec[]
  section: string
  values?: Record<string, any> | null
}

const str = (v: unknown) => (v == null ? '' : String(v))

function BoolField({ spec, initial }: { spec: FieldSpec; initial: boolean }) {
  const [on, setOn] = useState(initial)
  return (
    <div className="flex min-w-0 flex-col justify-end">
      <input type="hidden" name={spec.key} value={on ? 'true' : 'false'} />
      <Toggle id={`pf_${spec.key}`} checked={on} onChange={setOn} label={spec.label} />
      {spec.hint && <p className="mt-1 text-xs text-foreground-muted">{spec.hint}</p>}
    </div>
  )
}

function ColorField({ spec, initial }: { spec: FieldSpec; initial: string }) {
  const [v, setV] = useState(initial)
  const valid = /^#[0-9a-f]{6}$/i.test(v)
  return (
    <FormField label={spec.label} htmlFor={`pf_${spec.key}`} hint={spec.hint}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${spec.label} picker`}
          value={valid ? v : '#000000'}
          onChange={e => setV(e.target.value)}
          className="h-8 w-10 shrink-0 cursor-pointer rounded border border-border-secondary bg-surface p-0.5"
        />
        <TextInput id={`pf_${spec.key}`} name={spec.key} value={v} onChange={e => setV(e.target.value)} placeholder={spec.placeholder ?? '#000000'} maxLength={7} />
      </div>
    </FormField>
  )
}

function Field({ spec, values }: { spec: FieldSpec; values: Record<string, any> }) {
  const id = `pf_${spec.key}`
  const raw = values[spec.key]
  switch (spec.kind) {
    case 'bool':
      return <BoolField spec={spec} initial={raw == null ? spec.fallback === true : raw === true || raw === 'true'} />
    case 'color':
      return <ColorField spec={spec} initial={str(raw)} />
    case 'tristate':
      return (
        <FormField label={spec.label} htmlFor={id} hint={spec.hint}>
          <select id={id} name={spec.key} defaultValue={raw === true || raw === 'true' ? 'true' : raw === false || raw === 'false' ? 'false' : ''} className={fieldInputCls}>
            <option value="">Default</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </FormField>
      )
    case 'select':
      return (
        <AdminSelect
          id={id}
          name={spec.key}
          label={spec.label}
          hint={spec.hint}
          defaultValue={str(raw ?? spec.fallback ?? '')}
          placeholder="—"
          options={[...(spec.fallback === undefined ? [{ value: '', label: '—' }] : []), ...(spec.options ?? [])]}
        />
      )
    case 'longtext':
      return (
        <FormField label={spec.label} htmlFor={id} hint={spec.hint} span={2}>
          <TextArea id={id} name={spec.key} rows={spec.max && spec.max <= 320 ? 2 : 4} defaultValue={str(raw)} maxLength={spec.max} placeholder={spec.placeholder} />
        </FormField>
      )
    case 'links':
      return (
        <FormField label={spec.label} hint={spec.hint} span={2}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(spec.subkeys ?? []).map(sub => (
              <TextInput
                key={sub}
                type="url"
                name={`${spec.key}.${sub}`}
                aria-label={`${spec.label}: ${sub}`}
                defaultValue={str(raw && typeof raw === 'object' ? raw[sub] : '')}
                placeholder={`${sub.charAt(0).toUpperCase()}${sub.slice(1)} URL`}
              />
            ))}
          </div>
        </FormField>
      )
    case 'list':
      return (
        <FormField label={spec.label} htmlFor={id} hint={spec.hint}>
          <TextInput id={id} name={spec.key} defaultValue={Array.isArray(raw) ? raw.join(', ') : str(raw)} placeholder={spec.placeholder ?? 'a, b, c'} />
        </FormField>
      )
    case 'int':
    case 'decimal':
      return (
        <FormField label={spec.label} htmlFor={id} hint={spec.hint}>
          <NumberInput id={id} name={spec.key} defaultValue={str(raw)} min={spec.min} max={spec.maxValue} step={spec.kind === 'int' ? 1 : 'any'} placeholder={spec.placeholder} />
        </FormField>
      )
    default:
      return (
        <FormField label={spec.label} htmlFor={id} hint={spec.hint}>
          <TextInput id={id} name={spec.key} type={spec.kind === 'url' ? 'url' : 'text'} defaultValue={str(raw)} maxLength={spec.max} placeholder={spec.placeholder} />
        </FormField>
      )
  }
}

/** The inputs of one section of a FieldSpec list; names equal the spec keys so parseFields reads them. */
export default function EntityProfileFields({ specs, section, values }: Props) {
  const v = values ?? {}
  return (
    <FormGrid>
      {specs.filter(s => s.section === section).map(spec => (
        <Field key={spec.key} spec={spec} values={v} />
      ))}
    </FormGrid>
  )
}
