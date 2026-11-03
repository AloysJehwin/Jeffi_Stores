'use client'

import { useEffect, useState } from 'react'
import { SectionCard } from '@/components/admin/site-controls/controls'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { BUILTIN_VARIABLE_KEYS, VARIABLE_KEY_RE, type TemplateVariableDef } from '@/lib/templates/variables-shared'

interface CustomVar {
  id: string
  key: string
  label: string
  description: string
  value: string
  isEnabled: boolean
}

type Draft = Omit<CustomVar, 'id'>

const EMPTY: Draft = { key: '', label: '', description: '', value: '', isEnabled: true }

const INPUT =
  'w-full min-w-0 px-3 py-2 text-sm border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-accent-500'
const BTN_PRIMARY =
  'px-3 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg text-sm font-semibold transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed'
const BTN_GHOST =
  'px-3 py-2 border border-border-secondary rounded-lg text-sm text-foreground hover:bg-surface transition-colors disabled:opacity-50'

function KeyChip({ k }: { k: string }) {
  return (
    <code className="inline-block px-1.5 py-0.5 rounded bg-surface border border-border-default text-xs font-mono text-foreground">
      {`{${k}}`}
    </code>
  )
}

function keyError(key: string): string {
  if (!key) return 'Key is required'
  if (!VARIABLE_KEY_RE.test(key)) return 'Lowercase letters, digits and underscores only'
  if (BUILTIN_VARIABLE_KEYS.has(key)) return 'That key is a built-in variable'
  return ''
}

function VariableForm({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: Draft
  busy: boolean
  onSave: (d: Draft) => void
  onCancel?: () => void
}) {
  const [d, setD] = useState<Draft>(initial)
  const err = d.key ? keyError(d.key) : ''
  const canSave = !busy && !keyError(d.key) && d.label.trim().length > 0
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <input
            value={d.key}
            onChange={e => setD({ ...d, key: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
            placeholder="key (e.g. support_hours)"
            maxLength={64}
            className={`${INPUT} font-mono`}
          />
          {err && <p className="text-xs text-red-600 mt-1">{err}</p>}
        </div>
        <input
          value={d.label}
          onChange={e => setD({ ...d, label: e.target.value })}
          placeholder="Label (e.g. Support hours)"
          maxLength={120}
          className={INPUT}
        />
      </div>
      <input
        value={d.description}
        onChange={e => setD({ ...d, description: e.target.value })}
        placeholder="Description (optional)"
        className={INPUT}
      />
      <textarea
        value={d.value}
        onChange={e => setD({ ...d, value: e.target.value })}
        placeholder="Value inserted into emails"
        rows={2}
        className={INPUT}
      />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <label className="inline-flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={d.isEnabled} onChange={e => setD({ ...d, isEnabled: e.target.checked })} />
          Enabled
        </label>
        <div className="flex gap-2">
          {onCancel && (
            <button type="button" onClick={onCancel} disabled={busy} className={BTN_GHOST}>
              Cancel
            </button>
          )}
          <button type="button" onClick={() => onSave(d)} disabled={!canSave} className={BTN_PRIMARY}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

export default function TemplateVariablesPanel() {
  const [builtIns, setBuiltIns] = useState<TemplateVariableDef[]>([])
  const [custom, setCustom] = useState<CustomVar[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const canWrite = useCanWrite('settings:write')

  async function load() {
    const res = await fetch('/api/admin/template-variables', { credentials: 'include' })
    if (!res.ok) return
    const d = await res.json()
    setBuiltIns((d.variables || []).filter((v: TemplateVariableDef) => v.builtIn))
    setCustom(d.custom || [])
  }

  useEffect(() => {
    load()
  }, [])

  async function call(url: string, method: string, body?: unknown) {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        const field = d.fields ? Object.values(d.fields)[0] : ''
        throw new Error((field as string) || d.error || 'Request failed')
      }
      await load()
      return true
    } catch (e: any) {
      setError(e.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <SectionCard
      title="Insert variables"
      description="Placeholders every email composer can insert. Built-ins are filled per recipient; add your own with a fixed value."
    >
      <div className="space-y-5">
        <div>
          <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wide mb-2">Built-in</p>
          <div className="divide-y divide-border-default border border-border-default rounded-lg">
            {builtIns.map(v => (
              <div key={v.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <KeyChip k={v.key} />
                <span className="text-sm font-medium text-foreground">{v.label}</span>
                <span className="text-xs text-foreground-muted flex-1 min-w-[12rem]">{v.description}</span>
                <span className="text-xs text-foreground-muted italic">e.g. {v.sample}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-foreground-muted uppercase tracking-wide">Custom</p>
            {canWrite && !adding && (
              <button type="button" onClick={() => setAdding(true)} disabled={busy} className={BTN_GHOST}>
                Add variable
              </button>
            )}
          </div>
          {adding && (
            <div className="border border-border-default rounded-lg p-3 mb-3">
              <VariableForm
                initial={EMPTY}
                busy={busy}
                onCancel={() => setAdding(false)}
                onSave={async d => {
                  if (await call('/api/admin/template-variables', 'POST', d)) setAdding(false)
                }}
              />
            </div>
          )}
          {custom.length === 0 && !adding ? (
            <p className="text-xs text-foreground-muted italic">No custom variables yet.</p>
          ) : (
            <div className="divide-y divide-border-default border border-border-default rounded-lg">
              {custom.map(v =>
                editing === v.id ? (
                  <div key={v.id} className="p-3">
                    <VariableForm
                      initial={v}
                      busy={busy}
                      onCancel={() => setEditing(null)}
                      onSave={async d => {
                        if (await call(`/api/admin/template-variables/${v.id}`, 'PATCH', d)) setEditing(null)
                      }}
                    />
                  </div>
                ) : (
                  <div key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                    <KeyChip k={v.key} />
                    <span
                      className={`text-sm font-medium ${v.isEnabled ? 'text-foreground' : 'text-foreground-muted line-through'}`}
                    >
                      {v.label}
                    </span>
                    <span className="text-xs text-foreground-muted flex-1 min-w-[12rem] truncate" title={v.value}>
                      {v.value || <em>empty</em>}
                    </span>
                    <label className="inline-flex items-center gap-1.5 text-xs text-foreground-muted">
                      <input
                        type="checkbox"
                        checked={v.isEnabled}
                        disabled={busy || !canWrite}
                        onChange={e =>
                          call(`/api/admin/template-variables/${v.id}`, 'PATCH', { isEnabled: e.target.checked })
                        }
                      />
                      Enabled
                    </label>
                    {canWrite && (
                      <>
                        <button
                          type="button"
                          onClick={() => setEditing(v.id)}
                          disabled={busy}
                          className="text-xs text-accent-600 hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => call(`/api/admin/template-variables/${v.id}`, 'DELETE')}
                          disabled={busy}
                          className="text-xs text-red-600 hover:underline"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                )
              )}
            </div>
          )}
          {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        </div>
      </div>
    </SectionCard>
  )
}
