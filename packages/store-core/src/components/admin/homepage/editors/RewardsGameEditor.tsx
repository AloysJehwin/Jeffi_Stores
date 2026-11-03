'use client'

import { useEffect, useRef } from 'react'
import { rewardsGameConfig, rewardsGamePlayable, type RewardPrize } from '@/lib/catalog/homepage-sections'
import {
  Grid,
  HeadingFields,
  Note,
  Select,
  Text,
  copyHint,
  sectionCopy,
  useSectionBinding,
  type EditorProps,
} from './fields'
import TileListEditor, { type Tile } from './TileListEditor'

const MODE_OPTIONS = [
  { value: 'wheel', label: 'Spin the wheel' },
  { value: 'scratch', label: 'Scratch card' },
]
const LIMIT_OPTIONS = [
  { value: 'once', label: 'Once per customer' },
  { value: 'daily', label: 'Once a day' },
  { value: 'weekly', label: 'Once a week' },
]
const KIND_OPTIONS = [
  { value: 'percent', label: 'Percent off' },
  { value: 'fixed', label: 'Rupees off' },
  { value: 'none', label: 'No win (better luck next time)' },
]

// `id` rides along as a hidden tile key: issued coupons reference the prize by it.
const PRIZE_KEYS = ['id', 'label', 'kind', 'value', 'minPurchase', 'maxDiscount', 'validDays', 'weight']
const NUMERIC = ['value', 'minPurchase', 'maxDiscount', 'validDays', 'weight'] as const
const BLANK: Tile = { id: '', label: '', kind: 'percent', value: '', minPurchase: '', maxDiscount: '', validDays: '', weight: '' }

const text = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')

function readPrizes(raw: unknown): Tile[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
    .map(p => Object.fromEntries(PRIZE_KEYS.map(k => [k, text(p[k])])))
}

// What gets saved: ids minted for new prizes, numbers stored as numbers or left out.
function serialize(tiles: Tile[]) {
  return tiles.map(t => {
    const out: Record<string, unknown> = { id: t.id || crypto.randomUUID(), label: t.label, kind: t.kind }
    for (const k of NUMERIC) {
      const n = parseFloat(t[k])
      if (Number.isFinite(n)) out[k] = n
    }
    return out
  })
}

function odds(prizes: RewardPrize[]): string {
  const total = prizes.reduce((sum, p) => sum + p.weight, 0)
  return prizes.map(p => `${p.label} 1 in ${Number((total / p.weight).toFixed(1))}`).join(' · ')
}

export default function RewardsGameEditor(props: EditorProps) {
  const { section, canWrite, onChange, onSave } = props
  const b = useSectionBinding(props)
  const d = sectionCopy(props)
  const game = rewardsGameConfig(section)
  const tiles = readPrizes(b.cfg.prizes)
  const unused = tiles.length - game.prizes.length
  const minted = useRef(false)

  // One key per section, minted the first time a writer opens it and never replaced afterwards
  // (the server ignores a malformed key, so replacing one of those loses nothing).
  useEffect(() => {
    if (game.gameKey || !canWrite || minted.current) return
    minted.current = true
    const next = { ...(section.config ?? {}), gameKey: crypto.randomUUID() }
    onChange(section.id, { config: next })
    onSave(section.id, { config: next })
  }, [game.gameKey, canWrite, section.id, section.config, onChange, onSave])

  return (
    <Grid>
      <HeadingFields props={props} eyebrowHint="e.g. Your reward" />
      <Select
        label="Game type"
        value={game.mode}
        options={MODE_OPTIONS}
        disabled={!canWrite}
        onChange={v => b.saveConfig({ mode: v })}
      />
      <Select
        label="Play limit"
        value={game.playLimit}
        options={LIMIT_OPTIONS}
        disabled={!canWrite}
        hint="Days roll over at midnight IST, weeks on Monday."
        onChange={v => b.saveConfig({ playLimit: v })}
      />
      <Text
        label="Button label"
        value={section.cta_label ?? d.ctaLabel ?? ''}
        disabled={!canWrite}
        hint={copyHint(section.cta_label == null && !!d.ctaLabel, 'Opens the game.')}
        onCommit={b.ctaLabel}
      />

      <TileListEditor
        label="Prizes"
        hint="Up to 12. Percent prizes need a value from 1 to 90, rupee prizes a value above 0; a no-win segment needs only a label."
        tiles={tiles}
        fields={[
          { key: 'label', label: 'Label', placeholder: 'e.g. 10% off' },
          { key: 'kind', label: 'Prize type', kind: 'select', options: KIND_OPTIONS },
          { key: 'value', label: 'Value', placeholder: '10 or 100' },
          { key: 'minPurchase', label: 'Minimum order (₹)', placeholder: '0 for none' },
          { key: 'maxDiscount', label: 'Maximum discount (₹)', placeholder: 'Cap for percent prizes' },
          { key: 'validDays', label: 'Coupon valid for (days)', placeholder: '30' },
          { key: 'weight', label: 'Chance weight', placeholder: '1' },
        ]}
        blank={BLANK}
        disabled={!canWrite}
        max={12}
        showIcon={false}
        itemLabel="Prize"
        onCommit={next => b.saveConfig({ prizes: serialize(next) })}
      />
      {game.prizes.length > 0 && (
        <p className="sm:col-span-2 text-[11px] text-foreground-muted">Odds: {odds(game.prizes)}</p>
      )}
      <p className="sm:col-span-2 text-[11px] text-foreground-muted">
        {game.gameKey
          ? `Game id ${game.gameKey} · keeps play limits across publishes`
          : 'The game id is set the first time someone with write access opens this section.'}
      </p>

      {!rewardsGamePlayable(game) && (
        <Note>Add at least two prizes (one can be a no-win) — the game stays hidden until then.</Note>
      )}
      {unused > 0 && (
        <Note>
          {unused === 1 ? 'One prize is' : `${unused} prizes are`} not used yet — each needs a label; percent prizes a
          value from 1 to 90, rupee prizes a value above 0.
        </Note>
      )}
      <Note>Each win becomes a single-use personal coupon, shown to the customer at checkout.</Note>
      <Note>This section only appears on plans with customer programs (loyalty or referral) enabled.</Note>
    </Grid>
  )
}
