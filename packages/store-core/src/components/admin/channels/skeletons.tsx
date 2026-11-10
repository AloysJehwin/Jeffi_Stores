import { LoadingLines, LoadingSection, LoadingTable } from '@/components/admin/kit/skeleton'

// Loading shapes shared by the channel consoles (Amazon, Merchant, the ads consoles, marketplaces). Server-safe.

/** The RangePresets control with its real labels; the default preset is highlighted. */
export function RangeLoading({ presets = [7, 14, 30, 90], active = 30 }: { presets?: number[]; active?: number }) {
  return (
    <div className="flex h-control w-fit gap-0.5 rounded-lg border border-border-default bg-surface-elevated p-0.5">
      {presets.map(n => (
        <span key={n} className={`flex items-center rounded-md px-3 text-xs font-medium ${n === active ? 'bg-accent-500 text-white' : 'text-foreground-muted'}`}>
          {n}d
        </span>
      ))}
    </div>
  )
}

/** A titled section holding a table: real heading and column names, rows shimmer. */
export function TableSectionLoading({ title, columns, rows = 5, note }: { title: string; columns: string[]; rows?: number; note?: string }) {
  return (
    <LoadingSection title={title}>
      {note && <p className="mb-3 text-xs text-foreground-muted">{note}</p>}
      <LoadingTable bare columns={columns} rows={rows} />
    </LoadingSection>
  )
}

export const CHANGE_COLUMNS = ['When', 'By', 'Change', 'Result']
export const RUN_COLUMNS = ['Started', 'Job', 'Status', 'Rows', 'Errors']

/** The Alerts / Change history / Job runs tabs (ChannelPanels) while they load. */
export function ChannelPanelLoading({ tab }: { tab: 'alerts' | 'changes' | 'runs' }) {
  if (tab === 'alerts')
    return (
      <LoadingSection title="Alerts">
        <LoadingLines lines={3} />
      </LoadingSection>
    )
  return tab === 'changes' ? <TableSectionLoading title="Change history" columns={CHANGE_COLUMNS} /> : <TableSectionLoading title="Job runs" columns={RUN_COLUMNS} />
}
