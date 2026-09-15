'use client'

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
  fields: TileField[]
  blank: Tile
  disabled: boolean
  max?: number
  onCommit: (tiles: Tile[]) => void
}

const BTN_CLASS =
  'px-2 py-1 text-xs font-medium rounded-md border border-border-secondary bg-surface text-foreground hover:bg-surface-secondary disabled:opacity-40 disabled:cursor-not-allowed'

export default function TileListEditor({
  label, hint, tiles, fields, blank, disabled, max = 8, onCommit,
}: TileListEditorProps) {
  function replace(index: number, patch: Tile) {
    onCommit(tiles.map((t, i) => (i === index ? { ...t, ...patch } : t)))
  }

  function move(index: number, delta: number) {
    const target = index + delta
    if (target < 0 || target >= tiles.length) return
    const next = [...tiles]
    const [row] = next.splice(index, 1)
    next.splice(target, 0, row)
    onCommit(next)
  }

  return (
    <div className="sm:col-span-2">
      <div className="flex items-center justify-between mb-2">
        <label className={`${LABEL_CLASS} mb-0`}>{label}</label>
        <button
          type="button"
          disabled={disabled || tiles.length >= max}
          onClick={() => onCommit([...tiles, { ...blank }])}
          className={BTN_CLASS}
        >
          Add tile
        </button>
      </div>
      {hint && <p className="text-[11px] text-foreground-muted mb-2">{hint}</p>}

      {tiles.length === 0 && (
        <p className="text-xs text-foreground-muted rounded-lg border border-border-default bg-surface-secondary/40 px-3 py-2">
          No tiles configured — the built-in defaults are shown on the homepage.
        </p>
      )}

      <div className="space-y-3">
        {tiles.map((tile, i) => (
          <div key={i} className="rounded-lg border border-border-default bg-surface-secondary/30 p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-7 h-7 rounded-md bg-accent-500/10 flex items-center justify-center flex-shrink-0">
                  <IconByName name={tile.icon} className="w-4 h-4 text-accent-500" />
                </span>
                <span className="text-xs font-semibold text-foreground truncate">Tile {i + 1}</span>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button type="button" disabled={disabled || i === 0} onClick={() => move(i, -1)} className={BTN_CLASS}>Up</button>
                <button type="button" disabled={disabled || i === tiles.length - 1} onClick={() => move(i, 1)} className={BTN_CLASS}>Down</button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onCommit(tiles.filter((_, j) => j !== i))}
                  className={`${BTN_CLASS} text-red-600 dark:text-red-400`}
                >
                  Remove
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Select
                label="Icon"
                value={tile.icon ?? ''}
                options={ICON_OPTIONS}
                disabled={disabled}
                placeholder="Choose an icon"
                onChange={v => replace(i, { icon: v })}
              />
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
