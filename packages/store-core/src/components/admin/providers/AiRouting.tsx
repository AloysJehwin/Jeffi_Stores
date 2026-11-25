'use client'

import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDown, ArrowUp, ChevronRight, CloudOff, GripVertical, Plus, RotateCcw, TriangleAlert, X } from 'lucide-react'
import Select from '@/components/ui/Select'
import { Badge } from '@/components/admin/kit/core'
import { useActionToast } from '@/components/admin/kit/toast'
import {
  CAPS,
  EMBED_KEY,
  MODELS_KEY,
  ORDER_KEY,
  QUALITY_KEY,
  asList,
  asModels,
  asText,
  clearSettings,
  defaultEmbed,
  defaultModel,
  defaultOrder,
  inr,
  isOverridden,
  priceFor,
  providerLabel,
  providersOf,
  putSettings,
  same,
  statusesOf,
  unavailableReason,
  type Cap,
  type ModelMap,
  type ModelOption,
  type OrderCap,
  type ProviderStatus,
  type ProvidersData,
} from './model'
import { Panel, SaveButton, btnSmall, iconBtn, useSectionSave } from './parts'

// AI routing: per capability, the providers in fallback order, each with its model and the store's price.
// Embeddings take one provider. A store edits its own routing when canEdit.ai; otherwise it inherits the platform's.

const ORDER_CAPS: OrderCap[] = ['text', 'image', 'video', 'stt', 'tts']
const QUALITIES = ['draft', 'standard', 'premium']

type Routing = { orders: Record<OrderCap, string[]>; embed: string; models: ModelMap; quality: string }

function routingOf(settings: Record<string, unknown>, gateway: ProvidersData['gateway']): Routing {
  const orders = Object.fromEntries(
    ORDER_CAPS.map(cap => {
      const saved = asList(settings[ORDER_KEY[cap]])
      return [cap, saved.length ? saved : defaultOrder(gateway, cap)]
    })
  ) as Record<OrderCap, string[]>
  return { orders, embed: asText(settings[EMBED_KEY]) || defaultEmbed(gateway), models: asModels(settings[MODELS_KEY]), quality: asText(settings[QUALITY_KEY]) }
}

const pruned = (m: ModelMap): ModelMap => Object.fromEntries(Object.entries(m).filter(([, v]) => v && Object.keys(v).length)) as ModelMap

export default function AiRouting({ data, canWrite, onSaved }: { data: ProvidersData; canWrite: boolean; onSaved: () => Promise<void> }) {
  const toast = useActionToast()
  const store = data.scope.kind === 'store'
  const tenantId = store ? (data.scope.tenantId ?? null) : null
  const editable = canWrite && data.canEdit.ai
  const gateway = data.gateway

  const saved = useMemo(() => routingOf(data.settings, gateway), [data.settings, gateway])
  const [draft, setDraft] = useState(saved)
  useEffect(() => setDraft(saved), [saved])
  const { state, run, touch } = useSectionSave('AI routing')
  const edit = (fn: (d: Routing) => Routing) => {
    touch()
    setDraft(fn)
  }

  const changes: [string, unknown][] = [
    ...ORDER_CAPS.filter(c => !same(draft.orders[c], saved.orders[c])).map(c => [ORDER_KEY[c], draft.orders[c]] as [string, unknown]),
    ...(draft.embed !== saved.embed ? [[EMBED_KEY, draft.embed] as [string, unknown]] : []),
    ...(!same(pruned(draft.models), pruned(saved.models)) ? [[MODELS_KEY, pruned(draft.models)] as [string, unknown]] : []),
  ]
  const qualityChanged = draft.quality !== saved.quality
  const dirty = changes.length > 0 || qualityChanged
  const empty = ORDER_CAPS.filter(c => !draft.orders[c].length)

  const save = () =>
    run(async () => {
      const r = await putSettings(tenantId, [...changes, ...(qualityChanged && draft.quality ? [[QUALITY_KEY, draft.quality] as [string, unknown]] : [])])
      if (!r.ok || !qualityChanged || draft.quality) return r
      return clearSettings(tenantId, [QUALITY_KEY])
    }, onSaved)

  const modelsDiffer = (cap: Cap) =>
    isOverridden(data, MODELS_KEY) && !same(asModels(data.settings[MODELS_KEY])[cap], asModels(data.inherited?.[MODELS_KEY])[cap])
  const overridden = (cap: Cap) => isOverridden(data, cap === 'embed' ? EMBED_KEY : ORDER_KEY[cap]) || modelsDiffer(cap)

  async function reset(cap: Cap) {
    const key = cap === 'embed' ? EMBED_KEY : ORDER_KEY[cap]
    let r = await clearSettings(tenantId, isOverridden(data, key) ? [key] : [])
    if (r.ok && modelsDiffer(cap)) {
      const base = pruned(asModels(data.inherited?.[MODELS_KEY]))
      const next: ModelMap = { ...asModels(data.settings[MODELS_KEY]) }
      if (base[cap]) next[cap] = base[cap]
      else delete next[cap]
      r = same(pruned(next), base) ? await clearSettings(tenantId, [MODELS_KEY]) : await putSettings(tenantId, [[MODELS_KEY, pruned(next)]])
    }
    toast.result({ ok: r.ok, text: r.ok ? `${CAPS.find(c => c.id === cap)!.label} follows the platform again` : r.error })
    if (r.ok) await onSaved()
  }

  const setModel = (cap: Cap, provider: string, id: string) => edit(d => ({ ...d, models: { ...d.models, [cap]: { ...(d.models[cap] ?? {}), [provider]: id } } }))

  return (
    <Panel
      id="providers-ai"
      title="AI routing"
      description={
        store
          ? 'Each capability tries its providers in order and falls back to the next. Prices are what this store pays per use.'
          : 'Each capability tries its providers in order and falls back to the next. Stores follow this unless they set their own. Prices are what a store pays per use.'
      }
      actions={editable && <SaveButton label="Save AI routing" dirty={dirty} invalid={empty.length > 0} state={state} onSave={save} />}
    >
      {!gateway && (
        <p className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          <CloudOff aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" />
          The AI gateway did not answer. Routing is editable from the saved settings; model lists and readiness are unknown until it is back.
        </p>
      )}
      <div className="divide-y divide-border-default">
        {CAPS.map(c => {
          const head = (
            <RowHead
              label={c.label}
              note={c.note}
              store={store}
              overridden={store && overridden(c.id)}
              onReset={editable && store && overridden(c.id) ? () => reset(c.id) : undefined}
            >
              {c.id === 'image' && (
                <div className="mt-3 max-w-[11rem]">
                  <span className="mb-1 block text-[11px] text-foreground-muted">Default quality</span>
                  <Select
                    className="w-full"
                    size="sm"
                    aria-label="Default image quality"
                    value={draft.quality}
                    disabled={!editable}
                    onChange={v => edit(d => ({ ...d, quality: v }))}
                    options={[{ value: '', label: 'Caller decides' }, ...QUALITIES.map(q => ({ value: q, label: `${q[0].toUpperCase()}${q.slice(1)}` }))]}
                  />
                </div>
              )}
            </RowHead>
          )
          if (c.id === 'embed') {
            return (
              <EmbedRow
                key={c.id}
                head={head}
                data={data}
                value={draft.embed}
                savedValue={saved.embed}
                models={draft.models.embed ?? {}}
                editable={editable}
                onPick={p => edit(d => ({ ...d, embed: p }))}
                onModel={(p, id) => setModel('embed', p, id)}
              />
            )
          }
          return (
            <OrderRow
              key={c.id}
              cap={c.id}
              label={c.label}
              head={head}
              data={data}
              order={draft.orders[c.id]}
              models={draft.models[c.id] ?? {}}
              editable={editable}
              onOrder={order => edit(d => ({ ...d, orders: { ...d.orders, [c.id]: order } }))}
              onModel={(p, id) => setModel(c.id, p, id)}
            />
          )
        })}
      </div>
    </Panel>
  )
}

function RowHead({ label, note, store, overridden, onReset, children }: { label: string; note?: string; store: boolean; overridden: boolean; onReset?: () => void; children?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-sm font-medium text-foreground">{label}</p>
      {note && <p className="mt-0.5 text-xs text-foreground-muted">{note}</p>}
      {store && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {overridden ? <Badge tone="blue">Store override</Badge> : <Badge>Inherited from platform</Badge>}
          {onReset && (
            <button type="button" className={btnSmall} onClick={onReset} aria-label={`Reset ${label} to the platform's`}>
              <RotateCcw aria-hidden className="h-3 w-3" />
              Reset
            </button>
          )}
        </div>
      )}
      {children}
    </div>
  )
}

const rowCls = 'grid min-w-0 gap-3 py-4 first:pt-0 last:pb-0 lg:grid-cols-[11.5rem_minmax(0,1fr)] lg:gap-6'

function OrderRow({
  cap,
  label,
  head,
  data,
  order,
  models,
  editable,
  onOrder,
  onModel,
}: {
  cap: OrderCap
  label: string
  head: ReactNode
  data: ProvidersData
  order: string[]
  models: Record<string, string>
  editable: boolean
  onOrder: (o: string[]) => void
  onModel: (provider: string, id: string) => void
}) {
  const statuses = new Map(statusesOf(data.gateway, cap).map(s => [s.name, s]))
  const all = providersOf(data.gateway, cap, order)
  const rest = all.filter(p => !order.includes(p))
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const move = (i: number, d: -1 | 1) => onOrder(arrayMove(order, i, i + d))
  const onDragEnd = (e: DragEndEvent) => {
    const from = order.indexOf(String(e.active.id))
    const to = e.over ? order.indexOf(String(e.over.id)) : -1
    if (from >= 0 && to >= 0 && from !== to) onOrder(arrayMove(order, from, to))
  }

  return (
    <div className={rowCls} data-testid={`route-${cap}`}>
      {head}
      <div className="min-w-0">
        <DndContext id={`providers-${cap}`} sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={order} strategy={rectSortingStrategy}>
            <ol aria-label={`${label} order`} className="flex flex-wrap items-stretch gap-y-3">
              {order.map((p, i) => (
                <Chip
                  key={p}
                  cap={cap}
                  label={label}
                  provider={p}
                  index={i}
                  total={order.length}
                  status={statuses.get(p)}
                  gatewayDown={!data.gateway}
                  model={models[p]}
                  prices={data.prices}
                  editable={editable}
                  onMove={d => move(i, d)}
                  onRemove={() => onOrder(order.filter(x => x !== p))}
                  onModel={id => onModel(p, id)}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
        {!order.length && <p className="text-xs text-red-600 dark:text-red-400">Add at least one provider.</p>}
        {editable && rest.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-foreground-muted">Not in order</span>
            {rest.map(p => {
              const reason = unavailableReason(statuses.get(p))
              return (
                <button
                  key={p}
                  type="button"
                  disabled={!!reason}
                  title={reason ?? undefined}
                  onClick={() => onOrder([...order, p])}
                  aria-label={`Add ${providerLabel(p)} to ${label}`}
                  className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-border-secondary px-2.5 text-xs text-foreground hover:border-accent-500 hover:text-accent-600 disabled:cursor-not-allowed disabled:text-foreground-muted disabled:hover:border-border-secondary"
                >
                  <Plus aria-hidden className="h-3 w-3" />
                  {providerLabel(p)}
                  {reason && <span className="text-foreground-muted">· not configured</span>}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function ModelPicker({
  cap,
  provider,
  options,
  value,
  gatewayDown,
  disabled,
  onChange,
}: {
  cap: Cap
  provider: string
  options: ModelOption[] | undefined
  value: string | undefined
  gatewayDown: boolean
  disabled: boolean
  onChange: (id: string) => void
}) {
  const label = `${CAPS.find(c => c.id === cap)!.label} model for ${providerLabel(provider)}`
  if (!options?.length) {
    return (
      <p className="truncate font-mono text-xs text-foreground-secondary" title={gatewayDown ? 'Model list unknown while the gateway is down' : undefined}>
        <span className="sr-only">{label}: </span>
        {value || 'Default model'}
      </p>
    )
  }
  const current = value ?? defaultModel(options) ?? ''
  const opts = options.map(m => ({ value: m.id, label: m.label || m.id, hint: m.default ? 'Default' : undefined }))
  if (current && !options.some(m => m.id === current)) opts.push({ value: current, label: `${current} (not offered)`, hint: undefined })
  return <Select className="w-full" size="sm" aria-label={label} value={current} disabled={disabled} onChange={onChange} options={opts} />
}

function Price({ cap, provider, model, prices }: { cap: Cap; provider: string; model: string | null; prices: ProvidersData['prices'] }) {
  const p = priceFor(prices, cap, provider, model)
  if (!p) return <p className="text-[11px] text-foreground-muted">No price set</p>
  return (
    <p className="flex items-baseline justify-between gap-2">
      <span className="text-sm font-semibold tabular-nums text-foreground">{inr(p.inr)}</span>
      <span className="text-[11px] text-foreground-muted">{p.unit}</span>
    </p>
  )
}

function Chip({
  cap,
  label,
  provider,
  index,
  total,
  status,
  gatewayDown,
  model,
  prices,
  editable,
  onMove,
  onRemove,
  onModel,
}: {
  cap: OrderCap
  label: string
  provider: string
  index: number
  total: number
  status: ProviderStatus | undefined
  gatewayDown: boolean
  model: string | undefined
  prices: ProvidersData['prices']
  editable: boolean
  onMove: (d: -1 | 1) => void
  onRemove: () => void
  onModel: (id: string) => void
}) {
  const { setNodeRef, setActivatorNodeRef, listeners, transform, transition, isDragging } = useSortable({ id: provider, disabled: !editable })
  const reason = unavailableReason(status)
  const name = providerLabel(provider)
  const primary = index === 0 && !reason
  const shownModel = model ?? defaultModel(status?.models)
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`flex w-full items-stretch sm:w-auto ${isDragging ? 'z-10' : ''}`}
      data-testid={`chip-${cap}-${provider}`}
    >
      <div
        className={`flex w-full flex-col gap-2 rounded-lg p-3 sm:w-[15.5rem] ${
          reason
            ? 'border border-dashed border-border-secondary'
            : primary
              ? 'border border-accent-500/60 bg-surface shadow-[0_0_0_3px_rgb(var(--c-accent-500)/0.08)]'
              : 'border border-border-default bg-surface'
        } ${isDragging ? 'shadow-lg' : ''}`}
      >
        <div className="flex items-center gap-1.5">
          {editable && (
            <button
              type="button"
              ref={setActivatorNodeRef}
              {...listeners}
              tabIndex={-1}
              aria-hidden
              className="-ml-1 flex h-7 w-5 cursor-grab items-center justify-center text-foreground-muted active:cursor-grabbing"
            >
              <GripVertical className="h-3.5 w-3.5" />
            </button>
          )}
          <span
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums ${primary ? 'bg-accent-500 text-white' : 'bg-surface-secondary text-foreground-muted'}`}
          >
            <span className="sr-only">Position </span>
            {index + 1}
          </span>
          <span className={`min-w-0 flex-1 truncate text-sm font-medium ${reason ? 'text-foreground-muted' : 'text-foreground'}`}>{name}</span>
          {editable && (
            <span className="-mr-1 flex shrink-0 items-center">
              <button type="button" className={iconBtn} disabled={index === 0} onClick={() => onMove(-1)} aria-label={`Move ${name} up in ${label}`} title="Earlier">
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button type="button" className={iconBtn} disabled={index === total - 1} onClick={() => onMove(1)} aria-label={`Move ${name} down in ${label}`} title="Later">
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
              <button type="button" className={iconBtn} onClick={onRemove} aria-label={`Remove ${name} from ${label}`} title="Remove from the order">
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          )}
        </div>
        <ModelPicker cap={cap} provider={provider} options={status?.models} value={model} gatewayDown={gatewayDown} disabled={!editable || !!reason} onChange={onModel} />
        <Price cap={cap} provider={provider} model={shownModel} prices={prices} />
        {reason && (
          <p className="flex items-start gap-1 text-[11px] leading-4 text-amber-700 dark:text-amber-400">
            <TriangleAlert aria-hidden className="mt-px h-3 w-3 shrink-0" />
            {reason}
          </p>
        )}
      </div>
      {index < total - 1 && (
        <span aria-hidden className="hidden w-6 shrink-0 items-center justify-center text-foreground-muted sm:flex">
          <ChevronRight className="h-4 w-4" />
        </span>
      )}
    </li>
  )
}

function EmbedRow({
  head,
  data,
  value,
  savedValue,
  models,
  editable,
  onPick,
  onModel,
}: {
  head: ReactNode
  data: ProvidersData
  value: string
  savedValue: string
  models: Record<string, string>
  editable: boolean
  onPick: (p: string) => void
  onModel: (provider: string, id: string) => void
}) {
  const statuses = new Map(statusesOf(data.gateway, 'embed').map(s => [s.name, s]))
  const all = providersOf(data.gateway, 'embed', [value])
  const store = data.scope.kind === 'store'
  const changed = value !== savedValue
  return (
    <div className={rowCls} data-testid="route-embed">
      {head}
      <div className="min-w-0">
        <div role="radiogroup" aria-label="Embeddings provider" className="flex flex-wrap gap-3">
          {all.map(p => {
            const s = statuses.get(p)
            const reason = unavailableReason(s)
            const on = p === value
            const shownModel = models[p] ?? defaultModel(s?.models)
            return (
              <div
                key={p}
                data-testid={`chip-embed-${p}`}
                className={`flex w-full flex-col gap-2 rounded-lg p-3 sm:w-[15.5rem] ${
                  reason ? 'border border-dashed border-border-secondary' : on ? 'border border-accent-500/60 bg-surface shadow-[0_0_0_3px_rgb(var(--c-accent-500)/0.08)]' : 'border border-border-default bg-surface'
                }`}
              >
                <label className={`flex items-center gap-2 text-sm font-medium ${reason ? 'text-foreground-muted' : 'text-foreground'} ${editable && (!reason || on) ? 'cursor-pointer' : ''}`}>
                  <input
                    type="radio"
                    name={`embed-provider-${data.scope.tenantId ?? 'platform'}`}
                    className="h-4 w-4 accent-accent-500"
                    checked={on}
                    disabled={!editable || (!!reason && !on)}
                    onChange={() => onPick(p)}
                    aria-label={providerLabel(p)}
                  />
                  {providerLabel(p)}
                </label>
                <ModelPicker cap="embed" provider={p} options={s?.models} value={models[p]} gatewayDown={!data.gateway} disabled={!editable || !!reason} onChange={id => onModel(p, id)} />
                <Price cap="embed" provider={p} model={shownModel} prices={data.prices} />
                {reason && (
                  <p className="flex items-start gap-1 text-[11px] leading-4 text-amber-700 dark:text-amber-400">
                    <TriangleAlert aria-hidden className="mt-px h-3 w-3 shrink-0" />
                    {reason}
                  </p>
                )}
              </div>
            )
          })}
        </div>
        <p className={`mt-3 flex items-start gap-1.5 text-xs ${changed ? 'text-amber-700 dark:text-amber-400' : 'text-foreground-muted'}`}>
          <TriangleAlert aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" />
          {store
            ? "Switching re-embeds this store's catalog. Search falls back to keywords until it finishes."
            : "Switching re-embeds the catalog of every store that follows the platform. Search falls back to keywords until it finishes."}
        </p>
      </div>
    </div>
  )
}
