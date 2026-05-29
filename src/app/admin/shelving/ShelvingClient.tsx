'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Warehouse, ShelfLocation, ShelfStock,
  WarehouseForm, LocationForm, StockRow, AssignStockForm,
} from '@/components/admin/ShelvingParts'
import AdminSelect from '@/components/admin/AdminSelect'
import { useToast } from '@/contexts/ToastContext'
import { useConfirm } from '@/contexts/ConfirmContext'

type Tab = 'locations' | 'labels'
type Panel = 'warehouse' | 'location' | 'stock'

const btnPrimary = 'px-4 py-2.5 rounded-lg text-sm font-medium bg-secondary-500 hover:bg-secondary-600 dark:bg-secondary-400 dark:hover:bg-secondary-300 text-white dark:text-secondary-900 transition-colors disabled:opacity-50'
const btnSecondary = 'px-4 py-2.5 rounded-lg text-sm font-medium border border-border-default bg-surface hover:bg-surface-secondary text-foreground transition-colors disabled:opacity-50'
const labelCls = 'block text-xs font-medium text-foreground-secondary mb-1'
const inputCls = 'w-full px-3 py-2 rounded-lg border border-border-default bg-surface text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-secondary-500 focus:border-transparent transition-colors placeholder:text-foreground-muted'

function groupLocations(locs: ShelfLocation[]) {
  const tree: Record<string, Record<string, Record<string, ShelfLocation[]>>> = {}
  for (const loc of locs) {
    if (!tree[loc.aisle_code]) tree[loc.aisle_code] = {}
    if (!tree[loc.aisle_code][loc.rack_code]) tree[loc.aisle_code][loc.rack_code] = {}
    const shelfKey = `${loc.shelf_code}${loc.bin_code ? '/' + loc.bin_code : ''}`
    if (!tree[loc.aisle_code][loc.rack_code][shelfKey]) tree[loc.aisle_code][loc.rack_code][shelfKey] = []
    tree[loc.aisle_code][loc.rack_code][shelfKey].push(loc)
  }
  return tree
}

export default function ShelvingClient() {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const router = useRouter()
  const searchParams = useSearchParams()
  const tabParam = searchParams.get('tab') as Tab | null
  const [tab, setTabState] = useState<Tab>(
    tabParam && (['locations', 'labels'] as Tab[]).includes(tabParam) ? tabParam : 'locations'
  )
  function setTab(next: Tab) {
    setTabState(next)
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', next)
    router.replace(`/admin/shelving?${params.toString()}`, { scroll: false })
  }
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [locations, setLocations] = useState<ShelfLocation[]>([])
  const [stock, setStock] = useState<ShelfStock[]>([])
  const [selectedWarehouse, setSelectedWarehouse] = useState<string | null>(null)
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null)
  const [expandedAisles, setExpandedAisles] = useState<Record<string, boolean>>({})
  const [expandedRacks, setExpandedRacks] = useState<Record<string, boolean>>({})

  const [showWarehouseForm, setShowWarehouseForm] = useState(false)
  const [editWarehouse, setEditWarehouse] = useState<Warehouse | null>(null)
  const [showLocationForm, setShowLocationForm] = useState(false)
  const [editLocation, setEditLocation] = useState<ShelfLocation | null>(null)
  const [locationFormPrefill, setLocationFormPrefill] = useState<{ aisle?: string; rack?: string }>({})
  const [showAssignStock, setShowAssignStock] = useState(false)

  const [mobilePanel, setMobilePanel] = useState<Panel>('warehouse')
  const [labelSelections, setLabelSelections] = useState<string[]>([])
  const [labelCopies, setLabelCopies] = useState('1')
  const [generatingLabels, setGeneratingLabels] = useState(false)
  const [loading, setLoading] = useState(true)
  const [stockLoading, setStockLoading] = useState(false)
  const [error, setError] = useState('')

  const loadWarehouses = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/shelving/warehouses')
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      setWarehouses(data.warehouses || [])
    } catch { setError('Failed to load warehouses') }
  }, [])

  const loadLocations = useCallback(async (warehouseId: string) => {
    try {
      const res = await fetch(`/api/admin/shelving/locations?warehouse_id=${warehouseId}`)
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      setLocations(data.locations || [])
    } catch { setError('Failed to load locations') }
  }, [])

  const loadStock = useCallback(async (locationId: string) => {
    setStockLoading(true)
    try {
      const res = await fetch(`/api/admin/shelving/stock?location_id=${locationId}`)
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      setStock(data.stock || [])
    } catch { setError('Failed to load stock') } finally { setStockLoading(false) }
  }, [])

  useEffect(() => { loadWarehouses().finally(() => setLoading(false)) }, [loadWarehouses])
  useEffect(() => { if (selectedWarehouse) loadLocations(selectedWarehouse); else setLocations([]) }, [selectedWarehouse, loadLocations])
  useEffect(() => { if (selectedLocation) loadStock(selectedLocation); else setStock([]) }, [selectedLocation, loadStock])

  function selectWarehouse(id: string) {
    setSelectedWarehouse(id); setSelectedLocation(null)
    setExpandedAisles({}); setExpandedRacks({})
    setMobilePanel('location')
  }

  function selectLocation(id: string) {
    setSelectedLocation(id); setMobilePanel('stock'); setShowAssignStock(false)
  }

  const tree = useMemo(() => groupLocations(locations), [locations])
  const activeWarehouse = warehouses.find(w => w.id === selectedWarehouse)
  const activeLocation = locations.find(l => l.id === selectedLocation)

  function openAddLocation(prefill: { aisle?: string; rack?: string } = {}) {
    setEditLocation(null)
    setLocationFormPrefill(prefill)
    setShowLocationForm(true)
  }

  async function saveWarehouse(data: { name: string; code: string; address: string }) {
    if (editWarehouse) {
      const res = await fetch(`/api/admin/shelving/warehouses/${editWarehouse.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error((await res.json()).error)
    } else {
      const res = await fetch('/api/admin/shelving/warehouses', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error((await res.json()).error)
    }
    setShowWarehouseForm(false); setEditWarehouse(null)
    await loadWarehouses()
  }

  async function deleteWarehouse(id: string) {
    const ok = await confirm({
      title: 'Delete warehouse?',
      message: 'All locations must have no stock.',
      variant: 'danger',
      confirmLabel: 'Delete',
    })
    if (!ok) return
    const res = await fetch(`/api/admin/shelving/warehouses/${id}`, { method: 'DELETE' })
    if (!res.ok) { showToast((await res.json()).error || 'Failed to delete', 'error'); return }
    if (selectedWarehouse === id) setSelectedWarehouse(null)
    await loadWarehouses()
  }

  async function saveLocation(data: { aisle_code: string; rack_code: string; shelf_code: string; bin_code: string; notes: string }) {
    if (!selectedWarehouse) return
    if (editLocation) {
      const res = await fetch(`/api/admin/shelving/locations/${editLocation.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error((await res.json()).error)
    } else {
      const res = await fetch('/api/admin/shelving/locations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ warehouse_id: selectedWarehouse, ...data }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
    }
    setShowLocationForm(false); setEditLocation(null); setLocationFormPrefill({})
    await loadLocations(selectedWarehouse)
  }

  async function deleteLocation(id: string) {
    const ok = await confirm({
      title: 'Delete location?',
      message: 'It must have no stock assigned.',
      variant: 'danger',
      confirmLabel: 'Delete',
    })
    if (!ok) return
    const res = await fetch(`/api/admin/shelving/locations/${id}`, { method: 'DELETE' })
    if (!res.ok) { showToast((await res.json()).error || 'Failed to delete', 'error'); return }
    if (selectedLocation === id) setSelectedLocation(null)
    if (selectedWarehouse) await loadLocations(selectedWarehouse)
  }

  async function downloadLabels(locationIds: string[], copies: number, filename: string) {
    setGeneratingLabels(true)
    try {
      const res = await fetch('/api/admin/shelving/labels', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location_ids: locationIds, copies }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = filename
      a.click(); URL.revokeObjectURL(url)
    } catch (e: any) { showToast(e.message || 'Label generation failed', 'error') } finally { setGeneratingLabels(false) }
  }

  async function downloadSyntheticLabel(displayCode: string, warehouseName: string, filename: string) {
    setGeneratingLabels(true)
    try {
      const res = await fetch('/api/admin/shelving/labels', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ displayCode, warehouseName }], copies: 1 }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = filename
      a.click(); URL.revokeObjectURL(url)
    } catch (e: any) { showToast(e.message || 'Label generation failed', 'error') } finally { setGeneratingLabels(false) }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <div className="w-6 h-6 border-2 border-secondary-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="space-y-0 h-full flex flex-col">
      <div className="px-4 sm:px-6 py-4 border-b border-border-default bg-surface shrink-0">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-foreground">Shelving</h1>
            <p className="text-xs text-foreground-muted mt-0.5">Warehouse → Aisle → Rack → Shelf → Bin</p>
          </div>
          <div className="flex gap-1 border-b-0">
            {(['locations', 'labels'] as Tab[]).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px capitalize ${tab === t ? 'border-secondary-500 dark:border-secondary-400 text-secondary-500 dark:text-secondary-400' : 'border-transparent text-foreground-secondary hover:text-foreground'}`}>
                {t === 'locations' ? 'Locations' : 'Labels'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-4 sm:mx-6 mt-3 px-4 py-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {tab === 'labels' ? (
        <LabelsTab
          locations={locations} warehouses={warehouses}
          labelSelections={labelSelections} setLabelSelections={setLabelSelections}
          labelCopies={labelCopies} setLabelCopies={setLabelCopies}
          generating={generatingLabels} onGenerate={downloadLabels}
          selectedWarehouse={selectedWarehouse} setSelectedWarehouse={setSelectedWarehouse}
          loadLocations={loadLocations}
        />
      ) : (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <MobileBackBar panel={mobilePanel} setPanel={setMobilePanel} activeWarehouse={activeWarehouse} activeLocation={activeLocation} />

          <WarehousePanel
            warehouses={warehouses} selected={selectedWarehouse}
            onSelect={selectWarehouse} onAdd={() => { setEditWarehouse(null); setShowWarehouseForm(true) }}
            onEdit={w => { setEditWarehouse(w); setShowWarehouseForm(true) }}
            onDelete={deleteWarehouse} showForm={showWarehouseForm} editTarget={editWarehouse}
            onFormSave={saveWarehouse} onFormCancel={() => { setShowWarehouseForm(false); setEditWarehouse(null) }}
            mobilePanel={mobilePanel}
          />

          <LocationPanel
            tree={tree} locations={locations} selected={selectedLocation}
            onSelect={selectLocation}
            onAdd={openAddLocation}
            onEdit={loc => { setEditLocation(loc); setLocationFormPrefill({}); setShowLocationForm(true) }}
            onDelete={deleteLocation} showForm={showLocationForm} editTarget={editLocation}
            locationFormPrefill={locationFormPrefill}
            onFormSave={saveLocation} onFormCancel={() => { setShowLocationForm(false); setEditLocation(null); setLocationFormPrefill({}) }}
            expandedAisles={expandedAisles} setExpandedAisles={setExpandedAisles}
            expandedRacks={expandedRacks} setExpandedRacks={setExpandedRacks}
            selectedWarehouse={selectedWarehouse} mobilePanel={mobilePanel}
            onDownloadLabel={(ids, filename) => downloadLabels(ids, 1, filename)}
            onDownloadSynthetic={(displayCode, warehouseName, filename) => downloadSyntheticLabel(displayCode, warehouseName, filename)}
          />

          <StockPanel
            location={activeLocation} stock={stock} loading={stockLoading}
            locations={locations} showAssign={showAssignStock} setShowAssign={setShowAssignStock}
            onRefresh={() => selectedLocation && loadStock(selectedLocation)}
            onPrintLabel={selectedLocation ? () => downloadLabels([selectedLocation], 1, `shelf-label-${activeLocation?.display_code}.pdf`) : undefined}
            generating={generatingLabels} mobilePanel={mobilePanel}
          />
        </div>
      )}
    </div>
  )
}

function MobileBackBar({ panel, setPanel, activeWarehouse, activeLocation }: {
  panel: Panel; setPanel: (p: Panel) => void
  activeWarehouse?: Warehouse; activeLocation?: ShelfLocation
}) {
  if (panel === 'warehouse') return null
  return (
    <div className="lg:hidden fixed top-[96px] left-0 right-0 z-30 bg-surface border-b border-border-default px-4 py-2.5 flex items-center gap-2">
      <button onClick={() => setPanel(panel === 'stock' ? 'location' : 'warehouse')}
        className="flex items-center gap-1.5 text-sm font-medium text-secondary-500 dark:text-secondary-400 hover:text-secondary-600">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        {panel === 'stock' ? (activeLocation?.display_code ?? 'Locations') : (activeWarehouse?.name ?? 'Warehouses')}
      </button>
    </div>
  )
}

function WarehousePanel({ warehouses, selected, onSelect, onAdd, onEdit, onDelete, showForm, editTarget, onFormSave, onFormCancel, mobilePanel }: {
  warehouses: Warehouse[]; selected: string | null
  onSelect: (id: string) => void; onAdd: () => void
  onEdit: (w: Warehouse) => void; onDelete: (id: string) => void
  showForm: boolean; editTarget: Warehouse | null
  onFormSave: (d: any) => Promise<void>; onFormCancel: () => void
  mobilePanel: Panel
}) {
  const visible = mobilePanel === 'warehouse'
  return (
    <aside className={`${visible ? 'flex' : 'hidden'} lg:flex flex-col w-full lg:w-56 lg:max-w-56 shrink-0 border-r border-border-default bg-surface overflow-y-auto`}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-default shrink-0">
        <span className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Warehouses</span>
        <button onClick={onAdd}
          className="flex items-center gap-1 text-xs font-medium text-secondary-500 dark:text-secondary-400 hover:text-secondary-600 transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Add
        </button>
      </div>

      {showForm && (
        <div className="p-4 border-b border-border-default bg-surface-secondary shrink-0">
          <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide mb-3">
            {editTarget ? 'Edit Warehouse' : 'New Warehouse'}
          </p>
          <WarehouseForm onSave={onFormSave} onCancel={onFormCancel} initial={editTarget || undefined} />
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {warehouses.length === 0 && (
          <div className="py-12 text-center">
            <p className="text-sm text-foreground-secondary">No warehouses yet</p>
            <p className="text-xs text-foreground-muted mt-1">Add one to get started</p>
          </div>
        )}
        {warehouses.map(w => (
          <div key={w.id} onClick={() => onSelect(w.id)}
            className={`group flex items-center gap-2.5 px-4 py-3 cursor-pointer transition-colors border-b border-border-default/50 last:border-0 ${selected === w.id ? 'bg-secondary-50 dark:bg-secondary-900/20 border-r-2 border-r-secondary-500' : 'hover:bg-surface-secondary/60'}`}>
            <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded shrink-0 ${selected === w.id ? 'bg-secondary-500 dark:bg-secondary-400 text-white dark:text-secondary-900' : 'bg-surface-secondary text-foreground-secondary'}`}>
              {w.code}
            </span>
            <span className="flex-1 text-sm font-medium text-foreground truncate">{w.name}</span>
            {!w.is_active && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400 shrink-0">off</span>
            )}
            <div className="hidden group-hover:flex items-center gap-1 shrink-0">
              <button onClick={e => { e.stopPropagation(); onEdit(w) }}
                className="p-1 rounded hover:bg-surface-secondary text-foreground-secondary hover:text-secondary-500 transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
              </button>
              <button onClick={e => { e.stopPropagation(); onDelete(w.id) }}
                className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-foreground-secondary hover:text-red-500 transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </button>
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}

function PlusButton({ onClick, title }: { onClick: (e: React.MouseEvent) => void; title: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="opacity-0 group-hover:opacity-100 ml-auto flex items-center justify-center w-5 h-5 rounded hover:bg-secondary-100 dark:hover:bg-secondary-900/30 text-secondary-500 dark:text-secondary-400 transition-all shrink-0"
    >
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
    </button>
  )
}

function LabelButton({ onClick, title }: { onClick: (e: React.MouseEvent) => void; title: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="opacity-0 group-hover:opacity-100 flex items-center justify-center w-5 h-5 rounded hover:bg-secondary-100 dark:hover:bg-secondary-900/30 text-foreground-muted hover:text-secondary-500 dark:hover:text-secondary-400 transition-all shrink-0"
    >
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5l4.586 4.586a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-4-4a2 2 0 010-2.828L7 3z" /></svg>
    </button>
  )
}

function LocationPanel({ tree, locations, selected, onSelect, onAdd, onEdit, onDelete, showForm, editTarget, locationFormPrefill, onFormSave, onFormCancel, expandedAisles, setExpandedAisles, expandedRacks, setExpandedRacks, selectedWarehouse, mobilePanel, onDownloadLabel, onDownloadSynthetic }: {
  tree: ReturnType<typeof groupLocations>; locations: ShelfLocation[]; selected: string | null
  onSelect: (id: string) => void
  onAdd: (prefill?: { aisle?: string; rack?: string }) => void
  onEdit: (l: ShelfLocation) => void; onDelete: (id: string) => void
  showForm: boolean; editTarget: ShelfLocation | null
  locationFormPrefill: { aisle?: string; rack?: string }
  onFormSave: (d: any) => Promise<void>; onFormCancel: () => void
  expandedAisles: Record<string, boolean>; setExpandedAisles: (v: any) => void
  expandedRacks: Record<string, boolean>; setExpandedRacks: (v: any) => void
  selectedWarehouse: string | null; mobilePanel: Panel
  onDownloadLabel: (locationIds: string[], filename: string) => void
  onDownloadSynthetic: (displayCode: string, warehouseName: string, filename: string) => void
}) {
  const visible = mobilePanel === 'location'

  const prefillInitial = editTarget ? undefined : {
    aisle_code: locationFormPrefill.aisle || '',
    rack_code: locationFormPrefill.rack || '',
    shelf_code: '',
    bin_code: null,
    display_code: '',
    notes: null,
  } as Partial<import('@/components/admin/ShelvingParts').ShelfLocation>

  return (
    <div className={`${visible ? 'flex' : 'hidden'} lg:flex flex-col flex-1 lg:flex-none lg:w-72 border-r border-border-default bg-surface overflow-hidden`}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-default shrink-0">
        <span className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Locations</span>
        {selectedWarehouse && (
          <button onClick={() => onAdd()}
            className="flex items-center gap-1 text-xs font-medium text-secondary-500 dark:text-secondary-400 hover:text-secondary-600 transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            Add
          </button>
        )}
      </div>

      {showForm && (
        <div className="p-4 border-b border-border-default bg-surface-secondary shrink-0">
          <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide mb-3">
            {editTarget ? 'Edit Location' : locationFormPrefill.rack ? `New shelf in ${locationFormPrefill.aisle}-${locationFormPrefill.rack}` : locationFormPrefill.aisle ? `New rack in aisle ${locationFormPrefill.aisle}` : 'New Location'}
          </p>
          {selectedWarehouse && (
            <LocationForm
              warehouseId={selectedWarehouse}
              onSave={onFormSave}
              onCancel={onFormCancel}
              initial={editTarget || prefillInitial}
            />
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {!selectedWarehouse && (
          <div className="py-12 text-center px-4">
            <p className="text-sm text-foreground-secondary">No warehouse selected</p>
            <p className="text-xs text-foreground-muted mt-1">← Pick a warehouse first</p>
          </div>
        )}
        {selectedWarehouse && locations.length === 0 && (
          <div className="py-12 text-center px-4">
            <p className="text-sm text-foreground-secondary">No locations yet</p>
            <p className="text-xs text-foreground-muted mt-1">Add a location above</p>
          </div>
        )}
        {Object.entries(tree).sort(([a], [b]) => a.localeCompare(b)).map(([aisle, racks]) => (
          <div key={aisle}>
            <div className="group flex items-center gap-2 px-4 py-2.5 border-b border-border-default/40">
              <button
                onClick={() => setExpandedAisles((p: any) => ({ ...p, [aisle]: !p[aisle] }))}
                className="flex items-center gap-2 flex-1 min-w-0 hover:text-foreground text-left transition-colors"
              >
                <svg className={`w-3 h-3 transition-transform text-foreground-muted shrink-0 ${expandedAisles[aisle] ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                <span className="text-xs font-bold font-mono text-foreground">{aisle}</span>
                <span className="text-[10px] font-medium text-foreground-muted uppercase tracking-wide">Aisle</span>
              </button>
              <LabelButton onClick={e => { e.stopPropagation(); onDownloadLabel(locations.filter(l => l.aisle_code === aisle).map(l => l.id), `aisle-${aisle}.pdf`) }} title={`Download labels for aisle ${aisle}`} />
              <PlusButton onClick={e => { e.stopPropagation(); onAdd({ aisle }) }} title={`Add rack in aisle ${aisle}`} />
            </div>
            {expandedAisles[aisle] && Object.entries(racks).sort(([a], [b]) => a.localeCompare(b)).map(([rack, shelves]) => (
              <div key={rack}>
                <div className="group flex items-center gap-2 pl-8 pr-4 py-2 border-b border-border-default/30">
                  <button
                    onClick={() => setExpandedRacks((p: any) => ({ ...p, [`${aisle}-${rack}`]: !p[`${aisle}-${rack}`] }))}
                    className="flex items-center gap-2 flex-1 min-w-0 hover:text-foreground text-left transition-colors"
                  >
                    <svg className={`w-3 h-3 transition-transform text-foreground-muted shrink-0 ${expandedRacks[`${aisle}-${rack}`] ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                    <span className="text-xs font-semibold font-mono text-foreground-secondary">{rack}</span>
                    <span className="text-[10px] font-medium text-foreground-muted uppercase tracking-wide">Rack</span>
                  </button>
                  <LabelButton onClick={e => { e.stopPropagation(); onDownloadLabel(locations.filter(l => l.aisle_code === aisle && l.rack_code === rack).map(l => l.id), `rack-${aisle}-${rack}.pdf`) }} title={`Download labels for rack ${aisle}-${rack}`} />
                  <PlusButton onClick={e => { e.stopPropagation(); onAdd({ aisle, rack }) }} title={`Add shelf in ${aisle}-${rack}`} />
                </div>
                {expandedRacks[`${aisle}-${rack}`] && Object.entries(shelves).sort(([a], [b]) => a.localeCompare(b)).map(([, locs]) => (
                  locs.map(loc => (
                    <div key={loc.id} onClick={() => onSelect(loc.id)}
                      className={`group flex items-center gap-2 pl-14 pr-4 py-2 cursor-pointer transition-colors border-b border-border-default/20 last:border-0 ${selected === loc.id ? 'bg-secondary-50 dark:bg-secondary-900/20 border-r-2 border-r-secondary-500' : 'hover:bg-surface-secondary/60'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${selected === loc.id ? 'bg-secondary-500' : 'bg-foreground-muted/40'}`} />
                      <span className="text-xs font-mono flex-1 text-foreground">{loc.display_code}</span>
                      {loc.stock_count > 0 && (
                        <span className="text-[10px] font-medium text-foreground-muted shrink-0">{loc.stock_count}</span>
                      )}
                      <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                        <LabelButton onClick={e => { e.stopPropagation(); onDownloadLabel([loc.id], `shelf-label-${loc.display_code}.pdf`) }} title={`Download label for ${loc.display_code}`} />
                        <button onClick={e => { e.stopPropagation(); onEdit(loc) }}
                          className="p-1 rounded hover:bg-surface text-foreground-muted hover:text-secondary-500 transition-colors">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                        </button>
                        <button onClick={e => { e.stopPropagation(); onDelete(loc.id) }}
                          className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-foreground-muted hover:text-red-500 transition-colors">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </div>
                    </div>
                  ))
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function StockPanel({ location, stock, loading, locations, showAssign, setShowAssign, onRefresh, onPrintLabel, generating, mobilePanel }: {
  location?: ShelfLocation; stock: ShelfStock[]; loading: boolean
  locations: ShelfLocation[]; showAssign: boolean; setShowAssign: (v: boolean) => void
  onRefresh: () => void; onPrintLabel?: () => void; generating: boolean; mobilePanel: Panel
}) {
  const visible = mobilePanel === 'stock'
  return (
    <div className={`${visible ? 'flex' : 'hidden'} lg:flex flex-col flex-1 bg-surface-secondary overflow-hidden`}>
      {!location ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-sm font-medium text-foreground-secondary">No location selected</p>
            <p className="text-xs text-foreground-muted mt-1">← Select a shelf location to view stock</p>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-border-default bg-surface shrink-0">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-secondary-500 dark:text-secondary-400 text-base">{location.display_code}</span>
                {!location.is_active && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">inactive</span>
                )}
              </div>
              {location.notes && <p className="text-xs text-foreground-muted mt-0.5">{location.notes}</p>}
            </div>
            <div className="flex items-center gap-2">
              {onPrintLabel && (
                <button onClick={onPrintLabel} disabled={generating} className={btnSecondary + ' !py-2 !px-3 text-xs'}>
                  {generating ? (
                    <span className="flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" /></svg>
                      Generating…
                    </span>
                  ) : 'Print Label'}
                </button>
              )}
              <button onClick={() => setShowAssign(!showAssign)} className={btnPrimary + ' !py-2 !px-3 text-xs'}>
                + Assign Stock
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3">
            {showAssign && (
              <AssignStockForm location={location} onSave={() => { setShowAssign(false); onRefresh() }} onCancel={() => setShowAssign(false)} />
            )}

            {loading && (
              <div className="flex items-center justify-center py-16">
                <div className="w-6 h-6 border-2 border-secondary-500 border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            {!loading && stock.length === 0 && !showAssign && (
              <div className="bg-surface-elevated rounded-xl border border-border-default p-12 text-center">
                <p className="text-sm font-medium text-foreground-secondary">No stock assigned here yet</p>
                <p className="text-xs text-foreground-muted mt-1 mb-4">Use the button above to assign products to this location</p>
                <button onClick={() => setShowAssign(true)} className={btnPrimary + ' !py-2 !px-4 text-xs'}>
                  + Assign Stock
                </button>
              </div>
            )}

            {!loading && stock.length > 0 && (
              <div className="bg-surface-elevated rounded-xl border border-border-default">
                <div className="px-4 py-3 border-b border-border-default flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide">
                    Stock — {stock.length} SKU{stock.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="divide-y divide-border-default">
                  {stock.map(row => (
                    <StockRow key={row.id} row={row} locationId={location.id} siblingLocations={locations} onRefresh={onRefresh} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function LabelsTab({ locations, warehouses, labelSelections, setLabelSelections, labelCopies, setLabelCopies, generating, onGenerate, selectedWarehouse, setSelectedWarehouse, loadLocations }: {
  locations: ShelfLocation[]; warehouses: Warehouse[]
  labelSelections: string[]; setLabelSelections: (v: string[]) => void
  labelCopies: string; setLabelCopies: (v: string) => void
  generating: boolean; onGenerate: (ids: string[], copies: number, filename: string) => void
  selectedWarehouse: string | null; setSelectedWarehouse: (v: string | null) => void
  loadLocations: (id: string) => void
}) {
  const [filterAisle, setFilterAisle] = useState('')
  const [filterRack, setFilterRack] = useState('')
  const [filterShelf, setFilterShelf] = useState('')

  const aisles = Array.from(new Set(locations.map(l => l.aisle_code))).sort()
  const racks = Array.from(new Set(locations.filter(l => !filterAisle || l.aisle_code === filterAisle).map(l => l.rack_code))).sort()
  const shelves = Array.from(new Set(locations.filter(l => (!filterAisle || l.aisle_code === filterAisle) && (!filterRack || l.rack_code === filterRack)).map(l => l.shelf_code + (l.bin_code ? `-${l.bin_code}` : '')))).sort()

  const visibleLocations = locations.filter(l =>
    (!filterAisle || l.aisle_code === filterAisle) &&
    (!filterRack || l.rack_code === filterRack) &&
    (!filterShelf || (l.shelf_code + (l.bin_code ? `-${l.bin_code}` : '')) === filterShelf)
  )

  function toggleSelection(id: string) {
    setLabelSelections(labelSelections.includes(id) ? labelSelections.filter(x => x !== id) : [...labelSelections, id])
  }

  function clearFilters() {
    setFilterAisle(''); setFilterRack(''); setFilterShelf('')
  }

  const warehouseOptions = [
    { value: '', label: 'Select warehouse…' },
    ...warehouses.map(w => ({ value: w.id, label: `${w.name} (${w.code})` })),
  ]

  const selectedLocs = locations.filter(l => labelSelections.includes(l.id))

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden">
      {/* Left — filters + location list */}
      <div className="flex flex-col w-72 xl:w-80 shrink-0 border-r border-border-default bg-surface overflow-hidden">
        <div className="px-4 py-3 border-b border-border-default shrink-0">
          <span className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Filter Locations</span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <label className={labelCls}>Warehouse</label>
            <AdminSelect
              options={warehouseOptions}
              value={selectedWarehouse || ''}
              onChange={v => { setSelectedWarehouse(v || null); clearFilters(); setLabelSelections([]); if (v) loadLocations(v) }}
              placeholder="Select warehouse…"
              sm
            />
          </div>

          {selectedWarehouse && locations.length > 0 && (
            <>
              <div>
                <label className={labelCls}>Aisle</label>
                <AdminSelect
                  options={[{ value: '', label: 'All aisles' }, ...aisles.map(a => ({ value: a, label: a }))]}
                  value={filterAisle}
                  onChange={v => { setFilterAisle(v); setFilterRack(''); setFilterShelf('') }}
                  placeholder="All aisles"
                  sm
                />
              </div>
              <div>
                <label className={labelCls}>Rack</label>
                <AdminSelect
                  options={[{ value: '', label: 'All racks' }, ...racks.map(r => ({ value: r, label: r }))]}
                  value={filterRack}
                  onChange={v => { setFilterRack(v); setFilterShelf('') }}
                  placeholder="All racks"
                  sm
                />
              </div>
              <div>
                <label className={labelCls}>Shelf / Bin</label>
                <AdminSelect
                  options={[{ value: '', label: 'All shelves' }, ...shelves.map(s => ({ value: s, label: s }))]}
                  value={filterShelf}
                  onChange={v => setFilterShelf(v)}
                  placeholder="All shelves"
                  sm
                />
              </div>
            </>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className={labelCls + ' mb-0'}>Locations</span>
              <div className="flex gap-3">
                <button onClick={() => setLabelSelections(Array.from(new Set([...labelSelections, ...visibleLocations.map(l => l.id)])))}
                  className="text-xs font-medium text-secondary-500 dark:text-secondary-400 hover:text-secondary-600 transition-colors">
                  All
                </button>
                <button onClick={() => setLabelSelections(labelSelections.filter(id => !visibleLocations.find(l => l.id === id)))}
                  className="text-xs font-medium text-foreground-secondary hover:text-foreground transition-colors">
                  None
                </button>
              </div>
            </div>
            <div className="rounded-lg border border-border-default overflow-hidden">
              {visibleLocations.length === 0 && (
                <p className="text-sm text-foreground-secondary p-4 text-center">
                  {selectedWarehouse ? 'No locations match' : 'Select a warehouse'}
                </p>
              )}
              {visibleLocations.map(loc => (
                <label key={loc.id} className="flex items-center gap-3 px-3 py-2 hover:bg-surface-secondary/60 cursor-pointer border-b border-border-default last:border-0 transition-colors">
                  <input type="checkbox" checked={labelSelections.includes(loc.id)} onChange={() => toggleSelection(loc.id)}
                    className="rounded border-border-default text-secondary-500 focus:ring-secondary-500 shrink-0" />
                  <span className="font-mono text-xs font-medium text-foreground flex-1 truncate">{loc.display_code}</span>
                  {loc.stock_count > 0 && (
                    <span className="text-[10px] text-foreground-muted shrink-0">{loc.stock_count}</span>
                  )}
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Right — selected preview + generate */}
      <div className="flex flex-col flex-1 bg-surface-secondary overflow-hidden">
        <div className="px-5 py-3 border-b border-border-default bg-surface shrink-0 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide">Selected</span>
            {labelSelections.length > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-secondary-100 text-secondary-700 dark:bg-secondary-900/30 dark:text-secondary-400">
                {labelSelections.length} label{labelSelections.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-foreground-secondary whitespace-nowrap">Copies each</label>
              <input type="number" value={labelCopies} onChange={e => setLabelCopies(e.target.value)}
                className="w-16 px-2 py-1.5 rounded-lg border border-border-default bg-surface text-foreground text-xs text-center focus:outline-none focus:ring-2 focus:ring-secondary-500 focus:border-transparent transition-colors"
                min={1} max={50} />
            </div>
            {locations.length > 0 && (
              <button
                onClick={() => onGenerate(locations.map(l => l.id), parseInt(labelCopies) || 1, `shelf-labels-all-${new Date().toISOString().slice(0, 10)}.pdf`)}
                disabled={generating}
                className="px-4 py-2 rounded-lg text-sm font-medium border border-border-default bg-surface hover:bg-surface-secondary text-foreground transition-colors disabled:opacity-50 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                All ({locations.length})
              </button>
            )}
            <button
              onClick={() => onGenerate(labelSelections, parseInt(labelCopies) || 1, `shelf-labels-${new Date().toISOString().slice(0, 10)}.pdf`)}
              disabled={generating || labelSelections.length === 0}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-secondary-500 hover:bg-secondary-600 dark:bg-secondary-400 dark:hover:bg-secondary-300 text-white dark:text-secondary-900 transition-colors disabled:opacity-50 flex items-center gap-2">
              {generating ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" /></svg>
                  Generating…
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  Download PDF
                </>
              )}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {selectedLocs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <svg className="w-10 h-10 text-foreground-muted/40 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 7h.01M7 3h5l4.586 4.586a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-4-4a2 2 0 010-2.828L7 3z" /></svg>
              <p className="text-sm font-medium text-foreground-secondary">No labels selected</p>
              <p className="text-xs text-foreground-muted mt-1">Check locations on the left to add them here</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-3">
              {selectedLocs.map(loc => (
                <div key={loc.id} className="relative group/card bg-white dark:bg-neutral-900 rounded-lg border border-border-default shadow-sm aspect-[10/7] flex flex-col items-center justify-center p-2 overflow-hidden">
                  <button
                    onClick={() => toggleSelection(loc.id)}
                    className="absolute top-1 right-1 opacity-0 group-hover/card:opacity-100 w-4 h-4 flex items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30 text-red-500 hover:bg-red-200 transition-all text-[10px] leading-none"
                    title="Remove"
                  >×</button>
                  <span className="font-mono font-bold text-[11px] text-foreground text-center leading-tight">{loc.display_code}</span>
                  <span className="text-[9px] text-foreground-muted mt-0.5 text-center truncate w-full px-1">{loc.warehouse_name}</span>
                  {loc.stock_count > 0 && (
                    <span className="mt-1 text-[9px] font-medium text-secondary-500 dark:text-secondary-400">{loc.stock_count} SKU{loc.stock_count !== 1 ? 's' : ''}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
