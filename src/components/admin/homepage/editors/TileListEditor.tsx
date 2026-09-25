'use client'

import { useState } from 'react'
import IconByName from '@/components/visitor/home/IconByName'
import { ICON_OPTIONS } from './icon-options'
import { LABEL_CLASS, Select, Text, TextArea } from './fields'

export type Tile = Record<string, string>

export interface TileField {
  key: string
  label: string
  kind?: 'text' | 'textarea' | 'select'
  options?: { value: string; label: string }[]
  placeholder?: string
}

interface TileListEditorProps {
  label: string
  hint?: string
  tiles: Tile[]
  /** Built-in tiles the storefront shows while none are saved; shown and editable in their place. */
  defaults?: Tile[]
  fields: TileField[]
  blank: Tile
  disabled: boolean
  max?: number
  /** False for tiles without an icon, such as About stats. */
  showIcon?: boolean
  itemLabel?: string
  onCommit: (tiles: Tile[]) => void
}

const BTN_CLASS =
  'px-2 py-1 text-xs font-medium rounded-md border border-border-secondary bg-surface text-foreground hover:bg-surface-secondary disabled:opacity-40 disabled:cursor-not-allowed'

export default function TileListEditor({
  label, hint, tiles, defaults, fields, blank, disabled, max = 8, showIcon = true, itemLabel = 'Tile', onCommit,
}: TileListEditorProps) {
  const [confirmingRestore, setConfirmingRestore] = useState(false)
  const usingDefaults = tiles.length === 0 && !!defaults?.length
  const shown = usingDefaults && defaults ? defaults : tiles

  function replace(index: number, patch: Tile) {
    onCommit(shown.map((t, i) => (i === index ? { ...t, ...patch } : t)))
  }

  function move(index: number, delta: number) {
    const target = index + delta
    if (target < 0 || target >= shown.length) return
    const next = [...shown]
    const [row] = next.splice(index, 1)
    next.splice(target, 0, row)
    onCommit(next)
  }

  return (
    <div className="sm:col-span-2">
      <div className="flex items-center justify-between mb-2">
        <label className={`${LABEL_CLASS} mb-0`}>{label}</label>
        <div className="flex items-center gap-1">
          {!usingDefaults && tiles.length > 0 && !!defaults?.length && (
            confirmingRestore ? (
              <>
                <span className="text-[11px] text-foreground-muted">Replace your tiles with the built-in ones?</span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => { setConfirmingRestore(false); onCommit([]) }}
                  className={`${BTN_CLASS} text-red-600 dark:text-red-400`}
                >
                  Restore
                </button>
                <button type="button" onClick={() => setConfirmingRestore(false)} className={BTN_CLASS}>Cancel</button>
              </>
            ) : (
              <button type="button" disabled={disabled} onClick={() => setConfirmingRestore(true)} className={BTN_CLASS}>
                Restore built-in tiles
              </button>
            )
          )}
          <button
            type="button"
            disabled={disabled || shown.length >= max}
            onClick={() => onCommit([...shown, { ...blank }])}
            className={BTN_CLASS}
          >
            Add tile
          </button>
        </div>
      </div>
      {hint && <p className="text-[11px] text-foreground-muted mb-2">{hint}</p>}

      {usingDefaults && (
        <p className="text-xs text-foreground-muted rounded-lg border border-border-default bg-surface-secondary/40 px-3 py-2 mb-3">
          These are the built-in tiles shown on the homepage. Edit, reorder or remove any of them to make the list your own.
        </p>
      )}

      {shown.length === 0 && (
        <p className="text-xs text-foreground-muted rounded-lg border border-border-default bg-surface-secondary/40 px-3 py-2">
          No tiles yet. Add one to show it on the homepage.
        </p>
      )}

      <div className="space-y-3">
        {shown.map((tile, i) => (
          <div key={i} className="rounded-lg border border-border-default bg-surface-secondary/30 p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 min-w-0">
                {showIcon && (
                  <span className="w-7 h-7 rounded-md bg-accent-500/10 flex items-center justify-center flex-shrink-0">
                    <IconByName name={tile.icon} className="w-4 h-4 text-accent-500" />
                  </span>
                )}
                <span className="text-xs font-semibold text-foreground truncate">{itemLabel} {i + 1}</span>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button type="button" disabled={disabled || i === 0} onClick={() => move(i, -1)} className={BTN_CLASS}>Up</button>
                <button type="button" disabled={disabled || i === shown.length - 1} onClick={() => move(i, 1)} className={BTN_CLASS}>Down</button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onCommit(shown.filter((_, j) => j !== i))}
                  className={`${BTN_CLASS} text-red-600 dark:text-red-400`}
                >
                  Remove
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {showIcon && (
                <Select
                  label="Icon"
                  value={tile.icon ?? ''}
                  options={ICON_OPTIONS}
                  disabled={disabled}
                  placeholder="Choose an icon"
                  onChange={v => replace(i, { icon: v })}
                />
              )}
              {fields.map(f => (
                f.kind === 'textarea' ? (
                  <TextArea
                    key={`${i}-${f.key}`}
                    label={f.label}
                    value={tile[f.key] ?? ''}
                    disabled={disabled}
                    rows={2}
                    onCommit={v => replace(i, { [f.key]: v })}
                  />
                ) : f.kind === 'select' ? (
                  <Select
                    key={`${i}-${f.key}`}
                    label={f.label}
                    value={tile[f.key] ?? ''}
                    options={f.options ?? []}
                    disabled={disabled}
                    onChange={v => replace(i, { [f.key]: v })}
                  />
                ) : (
                  <Text
                    key={`${i}-${f.key}`}
                    label={f.label}
                    value={tile[f.key] ?? ''}
                    disabled={disabled}
                    placeholder={f.placeholder}
                    onCommit={v => replace(i, { [f.key]: v })}
                  />
                )
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function readTiles(raw: unknown, keys: string[]): Tile[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map(r => Object.fromEntries(keys.map(k => [k, typeof r[k] === 'string' ? (r[k] as string) : ''])))
}
