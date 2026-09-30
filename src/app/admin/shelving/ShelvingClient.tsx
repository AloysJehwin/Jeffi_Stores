'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Warehouse,
  ShelfLocation,
  ShelfStock,
  WarehouseForm,
  LocationForm,
  StockRow,
  AssignStockForm,
} from '@/components/admin/ShelvingParts'
import AdminSelect from '@/components/admin/AdminSelect'
import { useToast } from '@/contexts/ToastContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import { ap } from '@/lib/admin-path'
import { useCanWrite } from '@/contexts/AdminScopesContext'

type Tab = 'locations' | 'labels'

const btnPrimary =
  'control-sm border border-transparent bg-secondary-500 hover:bg-secondary-600 dark:bg-secondary-400 dark:hover:bg-secondary-300 text-white dark:text-secondary-900 font-medium transition-colors disabled:opacity-50'
const btnSecondary =
  'control-sm border border-border-default bg-surface hover:bg-surface-secondary text-foreground font-medium transition-colors'
const labelCls = 'block text-xs font-medium text-foreground-secondary mb-1'

export default function ShelvingClient() {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const canWrite = useCanWrite('shelving')
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
    router.push(ap(`/admin/shelving?${params.toString()}`), { scroll: false })
  }

  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [locations, setLocations] = useState<ShelfLocation[]>([])
  const [stock, setStock] = useState<ShelfStock[]>([])
  const [selectedWarehouse, setSelectedWarehouseState] = useState<string | null>(searchParams.get('wh'))
  const [selectedLocation, setSelectedLocationState] = useState<string | null>(searchParams.get('loc'))
  const [selectedAisle, setSelectedAisleState] = useState<string | null>(searchParams.get('aisle'))
  const [selectedRack, setSelectedRackState] = useState<string | null>(searchParams.get('rack'))
  const [selectedShelf, setSelectedShelf] = useState<string | null>(null)

  function pushParams(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(updates)) {
      if (v) params.set(k, v)
      else params.delete(k)
    }
    router.replace(ap(`/admin/shelving?${params.toString()}`), { scroll: false })
  }
  function setSelectedWarehouse(id: string | null) {
    setSelectedWarehouseState(id)
    pushParams({ wh: id, aisle: null, rack: null, loc: null })
  }
  function setSelectedAisle(a: string | null) {
    setSelectedAisleState(a)
    pushParams({ aisle: a, rack: null, loc: null })
  }
  function setSelectedRack(r: string | null) {
    setSelectedRackState(r)
    pushParams({ rack: r, loc: null })
  }
  function setSelectedLocation(id: string | null) {
    setSelectedLocationState(id)
    pushParams({ loc: id })
  }

  const [showWarehouseForm, setShowWarehouseForm] = useState(false)
  const [editWarehouse, setEditWarehouse] = useState<Warehouse | null>(null)
  const [showLocationForm, setShowLocationForm] = useState(false)
  const [editLocation, setEditLocation] = useState<ShelfLocation | null>(null)
  const [prefillLocation, setPrefillLocation] = useState<Partial<ShelfLocation>>({})
  const [prefillLocked, setPrefillLocked] = useState<('aisle' | 'rack' | 'shelf')[]>([])
  const [showAssignStock, setShowAssignStock] = useState(false)

  const [labelSelections, setLabelSelections] = useState<string[]>([])
  const [labelCopies, setLabelCopies] = useState('1')
  const [generatingLabels, setGeneratingLabels] = useState(false)
  const [loading, setLoading] = useState(true)
  const [locationsLoading, setLocationsLoading] = useState(false)
  const [stockLoading, setStockLoading] = useState(false)
  const [error, setError] = useState('')

  const loadWarehouses = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/shelving/warehouses')
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      setWarehouses(data.warehouses || [])
    } catch {
      setError('Failed to load warehouses')
    }
  }, [])

  const loadLocations = useCallback(async (warehouseId: string, restoreLocId?: string | null) => {
    setLocationsLoading(true)
    try {
      const res = await fetch(`/api/admin/shelving/locations?warehouse_id=${warehouseId}`)
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      const locs: ShelfLocation[] = data.locations || []
      setLocations(locs)
      // On initial mount restore: derive aisle/rack from the restored location
      if (restoreLocId) {
        const match = locs.find(l => l.id === restoreLocId)
        if (match) {
          setSelectedAisleState(match.aisle_code)
          setSelectedRackState(match.rack_code)
        }
      }
    } catch {
      setError('Failed to load locations')
    } finally {
      setLocationsLoading(false)
    }
  }, [])

  const loadStock = useCallback(async (locationId: string) => {
    setStockLoading(true)
    try {
      const res = await fetch(`/api/admin/shelving/stock?location_id=${locationId}`, { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      setStock(data.stock || [])
    } catch {
      setError('Failed to load stock')
    } finally {
      setStockLoading(false)
    }
  }, [])

  useEffect(() => {
    loadWarehouses().finally(() => setLoading(false))
  }, [loadWarehouses])
  const warehouseMountRef = useRef(true)
  useEffect(() => {
    if (selectedWarehouse) {
      if (warehouseMountRef.current) {
        // Initial mount: load locations but keep URL-restored aisle/rack/loc
        warehouseMountRef.current = false
        loadLocations(selectedWarehouse, selectedLocation)
      } else {
        // User switched warehouse: reset drill-down
        setSelectedLocationState(null)
        setSelectedAisleState(null)
        setSelectedRackState(null)
        setSelectedShelf(null)
        loadLocations(selectedWarehouse)
      }
    } else setLocations([])
  }, [selectedWarehouse, loadLocations])
  useEffect(() => {
    if (selectedLocation) loadStock(selectedLocation)
    else setStock([])
  }, [selectedLocation, loadStock])

  const activeWarehouse = warehouses.find(w => w.id === selectedWarehouse)
  const activeLocation = locations.find(l => l.id === selectedLocation)

  async function saveWarehouse(data: { name: string; code: string; address: string }) {
    if (editWarehouse) {
      const res = await fetch(`/api/admin/shelving/warehouses/${editWarehouse.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error((await res.json()).error)
    } else {
      const res = await fetch('/api/admin/shelving/warehouses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error((await res.json()).error)
    }
    setShowWarehouseForm(false)
    setEditWarehouse(null)
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
    if (!res.ok) {
      showToast((await res.json()).error || 'Failed to delete', 'error')
      return
    }
    if (selectedWarehouse === id) setSelectedWarehouse(null)
    await loadWarehouses()
  }

  async function saveLocation(data: {
    aisle_code: string
    rack_code: string
    shelf_code: string
    bin_code: string
    notes: string
  }) {
    if (!selectedWarehouse) return
    if (editLocation) {
      const res = await fetch(`/api/admin/shelving/locations/${editLocation.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error((await res.json()).error)
    } else {
      const res = await fetch('/api/admin/shelving/locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ warehouse_id: selectedWarehouse, ...data }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
    }
    setShowLocationForm(false)
    setEditLocation(null)
    setPrefillLocation({})
    setPrefillLocked([])
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
    if (!res.ok) {
      showToast((await res.json()).error || 'Failed to delete', 'error')
      return
    }
    if (selectedLocation === id) setSelectedLocation(null)
    if (selectedWarehouse) await loadLocations(selectedWarehouse)
  }

  async function downloadLabels(locationIds: string[], copies: number, filename: string) {
    setGeneratingLabels(true)
    try {
      const res = await fetch('/api/admin/shelving/labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location_ids: locationIds, copies }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      showToast(e.message || 'Label generation failed', 'error')
    } finally {
      setGeneratingLabels(false)
    }
  }

  async function downloadSyntheticLabel(displayCode: string, warehouseName: string, filename: string) {
    setGeneratingLabels(true)
    try {
      const res = await fetch('/api/admin/shelving/labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ displayCode, warehouseName }], copies: 1 }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      showToast(e.message || 'Label generation failed', 'error')
    } finally {
      setGeneratingLabels(false)
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Page header + tabs */}
      <div className="px-4 sm:px-6 py-4 border-b border-border-default bg-surface shrink-0">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-foreground">Shelving</h1>
            <p className="text-xs text-foreground-muted mt-0.5">Warehouse → Location → Stock</p>
          </div>
          <div className="flex gap-1">
            {(['locations', 'labels'] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px capitalize ${tab === t ? 'border-secondary-500 dark:border-secondary-400 text-secondary-500 dark:text-secondary-400' : 'border-transparent text-foreground-secondary hover:text-foreground'}`}
              >
                {t === 'locations' ? 'Locations' : 'Labels'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-4 sm:mx-6 mt-3 px-4 py-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 text-red-600 dark:text-red-400 text-sm shrink-0">
          {error}
        </div>
      )}

      {tab === 'labels' ? (
        <LabelsTab
          locations={locations}
          warehouses={warehouses}
          labelSelections={labelSelections}
          setLabelSelections={setLabelSelections}
          labelCopies={labelCopies}
          setLabelCopies={setLabelCopies}
          generating={generatingLabels}
          onGenerate={downloadLabels}
          selectedWarehouse={selectedWarehouse}
          setSelectedWarehouse={setSelectedWarehouse}
          loadLocations={loadLocations}
        />
      ) : (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {/* Chip bar */}
          <div className="shrink-0 bg-surface border-b border-border-default px-4 sm:px-6 py-3 space-y-2.5 overflow-visible">
            {/* Warehouse chips */}
            <div className="flex items-center gap-3 flex-wrap min-h-[28px]">
              <span className="text-[11px] font-semibold text-foreground-muted uppercase tracking-wide w-20 shrink-0 leading-7 self-center">
                Warehouse
              </span>
              <div className="flex items-center gap-1.5 flex-wrap flex-1">
                {loading ? (
                  <div className="flex gap-1.5">
                    {[80, 96, 72].map(w => (
                      <div
                        key={w}
                        className="h-7 rounded-full bg-surface-secondary animate-pulse"
                        style={{ width: w }}
                      />
                    ))}
                  </div>
                ) : warehouses.length === 0 ? (
                  <span className="text-xs text-foreground-muted italic">No warehouses yet</span>
                ) : (
                  warehouses.map(w => (
                    <WarehouseChip
                      key={w.id}
                      warehouse={w}
                      selected={selectedWarehouse === w.id}
                      canWrite={canWrite}
                      onSelect={() => {
                        setSelectedWarehouse(selectedWarehouse === w.id ? null : w.id)
                        setShowWarehouseForm(false)
                        setShowLocationForm(false)
                      }}
                      onEdit={() => {
                        setEditWarehouse(w)
                        setShowWarehouseForm(true)
                        setShowLocationForm(false)
                      }}
                      onDelete={() => deleteWarehouse(w.id)}
                    />
                  ))
                )}
                {canWrite && (
                  <button
                    onClick={() => {
                      setEditWarehouse(null)
                      setShowWarehouseForm(!showWarehouseForm)
                      setShowLocationForm(false)
                    }}
                    className="flex items-center gap-1 h-7 px-2.5 rounded-full border border-dashed border-border-default text-foreground-muted hover:border-secondary-400 hover:text-secondary-500 dark:hover:border-secondary-500 dark:hover:text-secondary-400 transition-colors text-xs"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add
                  </button>
                )}
              </div>
            </div>

            {/* Location drill-down — Aisle → Rack → Shelf/Bin */}
            {(() => {
              const aisles = Array.from(new Set(locations.map(l => l.aisle_code))).sort()
              const racksForAisle = selectedAisle
                ? Array.from(
                    new Set(locations.filter(l => l.aisle_code === selectedAisle).map(l => l.rack_code))
                  ).sort()
                : []
              const shelfsForRack =
                selectedAisle && selectedRack
                  ? locations.filter(l => l.aisle_code === selectedAisle && l.rack_code === selectedRack)
                  : []
              // Open shelf special: show at aisle level as its own chip row
              const openShelf = locations.find(l => l.is_open_shelf)
              const regularAisles = aisles.filter(a => {
                const locs = locations.filter(l => l.aisle_code === a)
                return !(locs.length === 1 && locs[0].is_open_shelf)
              })

              return (
                <>
                  {/* Row 1: Aisle */}
                  <div className="flex items-center gap-3 flex-wrap min-h-[28px]">
                    <span className="text-[11px] font-semibold text-foreground-muted uppercase tracking-wide w-20 shrink-0 leading-7 self-center">
                      Aisle
                    </span>
                    <div className="flex items-center gap-1.5 flex-wrap flex-1">
                      {!selectedWarehouse ? (
                        <span className="text-xs text-foreground-muted italic">Select a warehouse first</span>
                      ) : locationsLoading ? (
                        <div className="flex gap-1.5">
                          {[60, 60, 60].map((w, i) => (
                            <div
                              key={i}
                              className="h-7 rounded-full bg-surface-secondary animate-pulse"
                              style={{ width: w }}
                            />
                          ))}
                        </div>
                      ) : (
                        <>
                          {regularAisles.map(a => (
                            <LevelChip
                              key={a}
                              label={a}
                              selected={selectedAisle === a}
                              onSelect={() => {
                                setSelectedAisle(selectedAisle === a ? null : a)
                                setSelectedRack(null)
                                setSelectedShelf(null)
                                setSelectedLocation(null)
                              }}
                            />
                          ))}
                          {openShelf && (
                            <LocationChip
                              location={openShelf}
                              selected={selectedLocation === openShelf.id}
                              onSelect={() => {
                                setSelectedLocation(selectedLocation === openShelf.id ? null : openShelf.id)
                                setSelectedAisle(null)
                                setSelectedRack(null)
                                setShowLocationForm(false)
                                setShowAssignStock(false)
                              }}
                              onEdit={() => {
                                setEditLocation(openShelf)
                                setShowLocationForm(true)
                                setShowWarehouseForm(false)
                              }}
                              onDelete={() => deleteLocation(openShelf.id)}
                              onLabel={() =>
                                downloadSyntheticLabel(
                                  openShelf.display_code,
                                  activeWarehouse?.name || '',
                                  `shelf-label-${openShelf.display_code}.pdf`
                                )
                              }
                            />
                          )}
                          {selectedWarehouse && canWrite && (
                            <button
                              onClick={() => {
                                setEditLocation(null)
                                setPrefillLocation({})
                                setPrefillLocked([])
                                setShowLocationForm(!showLocationForm)
                                setShowWarehouseForm(false)
                              }}
                              className="flex items-center gap-1 h-7 px-2.5 rounded-full border border-dashed border-border-default text-foreground-muted hover:border-secondary-400 hover:text-secondary-500 dark:hover:border-secondary-500 dark:hover:text-secondary-400 transition-colors text-xs"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                              </svg>
                              Add
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Row 2: Rack (shown when aisle selected) */}
                  {selectedAisle && (racksForAisle.length > 0 || selectedWarehouse) && (
                    <div className="flex items-center gap-3 flex-wrap min-h-[28px]">
                      <span className="text-[11px] font-semibold text-foreground-muted uppercase tracking-wide w-20 shrink-0 leading-7 self-center flex items-center gap-1">
                        <svg
                          className="w-3 h-3 text-foreground-muted/50"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        Rack
                      </span>
                      <div className="flex items-center gap-1.5 flex-wrap flex-1">
                        {racksForAisle.map(r => (
                          <LevelChip
                            key={r}
                            label={r}
                            selected={selectedRack === r}
                            onSelect={() => {
                              setSelectedRack(selectedRack === r ? null : r)
                              setSelectedShelf(null)
                              setSelectedLocation(null)
                            }}
                          />
                        ))}
                        {canWrite && (
                          <button
                            onClick={() => {
                              setEditLocation(null)
                              setPrefillLocation({ aisle_code: selectedAisle })
                              setPrefillLocked(['aisle'])
                              setShowLocationForm(true)
                              setShowWarehouseForm(false)
                            }}
                            className="flex items-center gap-1 h-7 px-2.5 rounded-full border border-dashed border-border-default text-foreground-muted hover:border-secondary-400 hover:text-secondary-500 dark:hover:border-secondary-500 dark:hover:text-secondary-400 transition-colors text-xs"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            Add
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Row 3: Shelf/Bin (shown when rack selected) */}
                  {selectedAisle && selectedRack && (
                    <div className="flex items-center gap-3 flex-wrap min-h-[28px]">
                      <span className="text-[11px] font-semibold text-foreground-muted uppercase tracking-wide w-20 shrink-0 leading-7 self-center flex items-center gap-1">
                        <svg
                          className="w-3 h-3 text-foreground-muted/50"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        Shelf
                      </span>
                      <div className="flex items-center gap-1.5 flex-wrap flex-1">
                        {shelfsForRack.map(loc => (
                          <LocationChip
                            key={loc.id}
                            location={loc}
                            selected={selectedLocation === loc.id}
                            onSelect={() => {
                              setSelectedLocation(selectedLocation === loc.id ? null : loc.id)
                              setShowLocationForm(false)
                              setShowAssignStock(false)
                            }}
                            onEdit={() => {
                              setEditLocation(loc)
                              setShowLocationForm(true)
                              setShowWarehouseForm(false)
                            }}
                            onDelete={() => deleteLocation(loc.id)}
                            onLabel={() => downloadLabels([loc.id], 1, `shelf-label-${loc.display_code}.pdf`)}
                          />
                        ))}
                        {canWrite && (
                          <button
                            onClick={() => {
                              setEditLocation(null)
                              setPrefillLocation({ aisle_code: selectedAisle, rack_code: selectedRack })
                              setPrefillLocked(['aisle', 'rack'])
                              setShowLocationForm(true)
                              setShowWarehouseForm(false)
                            }}
                            className="flex items-center gap-1 h-7 px-2.5 rounded-full border border-dashed border-border-default text-foreground-muted hover:border-secondary-400 hover:text-secondary-500 dark:hover:border-secondary-500 dark:hover:text-secondary-400 transition-colors text-xs"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            Add
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )
            })()}
          </div>

          {/* Inline forms (warehouse or location, one at a time) */}
          {(showWarehouseForm || showLocationForm) && (
            <div className="shrink-0 px-4 sm:px-6 py-4 border-b border-border-default bg-surface-secondary">
              {showWarehouseForm && (
                <>
                  <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide mb-3">
                    {editWarehouse ? 'Edit Warehouse' : 'New Warehouse'}
                  </p>
                  <WarehouseForm
                    onSave={saveWarehouse}
                    onCancel={() => {
                      setShowWarehouseForm(false)
                      setEditWarehouse(null)
                    }}
                    initial={editWarehouse || undefined}
                  />
                </>
              )}
              {showLocationForm && selectedWarehouse && (
                <>
                  <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide mb-3">
                    {editLocation ? 'Edit Location' : 'New Location'}
                  </p>
                  <LocationForm
                    warehouseId={selectedWarehouse}
                    onSave={saveLocation}
                    onCancel={() => {
                      setShowLocationForm(false)
                      setEditLocation(null)
                      setPrefillLocation({})
                      setPrefillLocked([])
                    }}
                    initial={editLocation || prefillLocation}
                    lockedLevels={editLocation ? [] : prefillLocked}
                  />
                </>
              )}
            </div>
          )}

          {/* Stock panel — full width */}
          <div className="flex-1 flex flex-col bg-surface-secondary overflow-hidden">
            {!activeLocation ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <p className="text-sm font-medium text-foreground-secondary">No location selected</p>
                  <p className="text-xs text-foreground-muted mt-1">Pick a location chip above to view stock</p>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-border-default bg-surface shrink-0">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-secondary-500 dark:text-secondary-400 text-base">
                        {activeLocation.display_code}
                      </span>
                      {!activeLocation.is_active && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
                          inactive
                        </span>
                      )}
                    </div>
                    {activeLocation.notes && (
                      <p className="text-xs text-foreground-muted mt-0.5">{activeLocation.notes}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Location actions: label, edit, delete */}
                    {selectedLocation && !activeLocation.is_open_shelf && canWrite && (
                      <>
                        <button
                          onClick={() => {
                            setEditLocation(activeLocation)
                            setShowLocationForm(true)
                            setShowWarehouseForm(false)
                          }}
                          title="Edit location"
                          className={btnSecondary + ' !px-2 !py-1'}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                            />
                          </svg>
                        </button>
                        <button
                          onClick={() => deleteLocation(selectedLocation)}
                          title="Delete location"
                          className="px-2 py-1 rounded-lg text-sm border border-border-default bg-surface hover:bg-red-50 dark:hover:bg-red-900/20 text-foreground-muted hover:text-red-500 transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
                        </button>
                        <div className="w-px h-5 bg-border-default" />
                      </>
                    )}
                    {selectedLocation && (
                      <button
                        onClick={() => {
                          if (activeLocation.is_open_shelf) {
                            downloadSyntheticLabel(
                              activeLocation.display_code,
                              activeWarehouse?.name || '',
                              `shelf-label-${activeLocation.display_code}.pdf`
                            )
                          } else {
                            downloadLabels([selectedLocation], 1, `shelf-label-${activeLocation.display_code}.pdf`)
                          }
                        }}
                        disabled={generatingLabels}
                        className={btnSecondary + ' !px-3 text-xs'}
                      >
                        {generatingLabels ? 'Generating…' : 'Print Label'}
                      </button>
                    )}
                    {canWrite && (
                      <button
                        onClick={() => setShowAssignStock(!showAssignStock)}
                        className={btnPrimary + ' !px-3 text-xs'}
                      >
                        + Assign Stock
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3">
                  {showAssignStock && (
                    <AssignStockForm
                      location={activeLocation}
                      onSave={() => {
                        setShowAssignStock(false)
                        selectedLocation && loadStock(selectedLocation)
                      }}
                      onCancel={() => setShowAssignStock(false)}
                    />
                  )}

                  {stockLoading && (
                    <div className="flex items-center justify-center py-16">
                      <div className="w-6 h-6 border-2 border-secondary-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}

                  {!stockLoading && stock.length === 0 && !showAssignStock && (
                    <div className="bg-surface-elevated rounded-xl border border-border-default p-12 text-center">
                      <p className="text-sm font-medium text-foreground-secondary">No stock assigned here yet</p>
                      <p className="text-xs text-foreground-muted mt-1 mb-4">
                        Use the button above to assign products to this location
                      </p>
                      {canWrite && (
                        <button onClick={() => setShowAssignStock(true)} className={btnPrimary + ' !px-4 text-xs'}>
                          + Assign Stock
                        </button>
                      )}
                    </div>
                  )}

                  {!stockLoading && stock.length > 0 && (
                    <div className="bg-surface-elevated rounded-xl border border-border-default">
                      <div className="px-4 py-3 border-b border-border-default flex items-center justify-between">
                        <span className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide">
                          Stock — {stock.length} SKU{stock.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className="divide-y divide-border-default">
                        {stock.map(row => (
                          <StockRow
                            key={row.id}
                            row={row}
                            locationId={activeLocation.id}
                            siblingLocations={locations}
                            onRefresh={() => selectedLocation && loadStock(selectedLocation)}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function LevelChip({ label, selected, onSelect }: { label: string; selected: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className={`flex items-center h-7 px-3 rounded-full text-xs font-mono font-semibold transition-colors ${
        selected
          ? 'bg-secondary-500 dark:bg-secondary-400 text-white dark:text-secondary-900'
          : 'bg-surface-secondary border border-border-default text-foreground hover:bg-secondary-50 dark:hover:bg-secondary-900/20 hover:border-secondary-300 dark:hover:border-secondary-700'
      }`}
    >
      {label}
    </button>
  )
}

function WarehouseChip({
  warehouse,
  selected,
  canWrite,
  onSelect,
  onEdit,
  onDelete,
}: {
  warehouse: Warehouse
  selected: boolean
  canWrite: boolean
  onSelect: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="group relative inline-flex items-center">
      <button
        onClick={onSelect}
        className={`flex items-center gap-1.5 h-7 pl-2 pr-2.5 rounded-full text-xs font-medium transition-colors ${
          selected
            ? 'bg-secondary-500 dark:bg-secondary-400 text-white dark:text-secondary-900'
            : 'bg-surface-secondary border border-border-default text-foreground hover:bg-secondary-50 dark:hover:bg-secondary-900/20 hover:border-secondary-300 dark:hover:border-secondary-700'
        }`}
      >
        <span
          className={`text-[10px] font-mono font-bold px-1 py-0.5 rounded ${
            selected ? 'bg-white/20 dark:bg-black/20 text-inherit' : 'bg-surface text-foreground-secondary'
          }`}
        >
          {warehouse.code}
        </span>
        <span>{warehouse.name}</span>
        {!warehouse.is_active && (
          <span
            className={`text-[9px] px-1 py-0.5 rounded-full ${selected ? 'bg-white/20 text-inherit' : 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400'}`}
          >
            off
          </span>
        )}
      </button>
      <div className="hidden group-hover:flex items-center gap-0.5 ml-0.5">
        {canWrite && (
          <button
            onClick={e => {
              e.stopPropagation()
              onEdit()
            }}
            className="flex items-center justify-center w-5 h-5 rounded hover:bg-surface-secondary text-foreground-muted hover:text-secondary-500 transition-colors"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
          </button>
        )}
        {canWrite && (
          <button
            onClick={e => {
              e.stopPropagation()
              onDelete()
            }}
            className="flex items-center justify-center w-5 h-5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-foreground-muted hover:text-red-500 transition-colors"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}

function LocationChip({
  location,
  selected,
  onSelect,
  onEdit,
  onDelete,
  onLabel,
}: {
  location: ShelfLocation
  selected: boolean
  onSelect: () => void
  onEdit: () => void
  onDelete: () => void
  onLabel: () => void
}) {
  return (
    <div className="inline-flex items-center">
      <button
        onClick={onSelect}
        className={`flex items-center gap-1.5 h-7 pl-2.5 pr-2.5 rounded-full text-xs font-mono font-medium transition-colors ${
          selected
            ? 'bg-secondary-500 dark:bg-secondary-400 text-white dark:text-secondary-900'
            : 'bg-surface-secondary border border-border-default text-foreground hover:bg-secondary-50 dark:hover:bg-secondary-900/20 hover:border-secondary-300 dark:hover:border-secondary-700'
        } ${location.is_open_shelf ? 'italic' : ''}`}
      >
        {location.display_code}
        {location.stock_count > 0 && (
          <span className={`text-[10px] font-sans ${selected ? 'opacity-70' : 'text-foreground-muted'}`}>
            {location.stock_count}
          </span>
        )}
      </button>
    </div>
  )
}

function LabelsTab({
  locations,
  warehouses,
  labelSelections,
  setLabelSelections,
  labelCopies,
  setLabelCopies,
  generating,
  onGenerate,
  selectedWarehouse,
  setSelectedWarehouse,
  loadLocations,
}: {
  locations: ShelfLocation[]
  warehouses: Warehouse[]
  labelSelections: string[]
  setLabelSelections: (v: string[]) => void
  labelCopies: string
  setLabelCopies: (v: string) => void
  generating: boolean
  onGenerate: (ids: string[], copies: number, filename: string) => void
  selectedWarehouse: string | null
  setSelectedWarehouse: (v: string | null) => void
  loadLocations: (id: string) => void
}) {
  const [filterAisle, setFilterAisle] = useState('')
  const [filterRack, setFilterRack] = useState('')
  const [filterShelf, setFilterShelf] = useState('')

  const aisles = Array.from(new Set(locations.map(l => l.aisle_code))).sort()
  const racks = Array.from(
    new Set(locations.filter(l => !filterAisle || l.aisle_code === filterAisle).map(l => l.rack_code))
  ).sort()
  const shelves = Array.from(
    new Set(
      locations
        .filter(l => (!filterAisle || l.aisle_code === filterAisle) && (!filterRack || l.rack_code === filterRack))
        .map(l => l.shelf_code + (l.bin_code ? `-${l.bin_code}` : ''))
    )
  ).sort()

  const visibleLocations = locations.filter(
    l =>
      (!filterAisle || l.aisle_code === filterAisle) &&
      (!filterRack || l.rack_code === filterRack) &&
      (!filterShelf || l.shelf_code + (l.bin_code ? `-${l.bin_code}` : '') === filterShelf)
  )

  function toggleSelection(id: string) {
    setLabelSelections(labelSelections.includes(id) ? labelSelections.filter(x => x !== id) : [...labelSelections, id])
  }

  function clearFilters() {
    setFilterAisle('')
    setFilterRack('')
    setFilterShelf('')
  }

  const warehouseOptions = [
    { value: '', label: 'Select warehouse…' },
    ...warehouses.map(w => ({ value: w.id, label: `${w.name} (${w.code})` })),
  ]

  const selectedLocs = locations.filter(l => labelSelections.includes(l.id))

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden">
      <div className="flex flex-col w-72 xl:w-80 shrink-0 border-r border-border-default bg-surface overflow-hidden">
        <div className="px-4 py-3 border-b border-border-default shrink-0">
          <span className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide">
            Filter Locations
          </span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <label className={labelCls}>Warehouse</label>
            <AdminSelect
              options={warehouseOptions}
              value={selectedWarehouse || ''}
              onChange={v => {
                setSelectedWarehouse(v || null)
                clearFilters()
                setLabelSelections([])
                if (v) loadLocations(v)
              }}
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
                  onChange={v => {
                    setFilterAisle(v)
                    setFilterRack('')
                    setFilterShelf('')
                  }}
                  placeholder="All aisles"
                  sm
                />
              </div>
              <div>
                <label className={labelCls}>Rack</label>
                <AdminSelect
                  options={[{ value: '', label: 'All racks' }, ...racks.map(r => ({ value: r, label: r }))]}
                  value={filterRack}
                  onChange={v => {
                    setFilterRack(v)
                    setFilterShelf('')
                  }}
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
                <button
                  onClick={() =>
                    setLabelSelections(Array.from(new Set([...labelSelections, ...visibleLocations.map(l => l.id)])))
                  }
                  className="text-xs font-medium text-secondary-500 dark:text-secondary-400 hover:text-secondary-600 transition-colors"
                >
                  All
                </button>
                <button
                  onClick={() =>
                    setLabelSelections(labelSelections.filter(id => !visibleLocations.find(l => l.id === id)))
                  }
                  className="text-xs font-medium text-foreground-secondary hover:text-foreground transition-colors"
                >
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
                <label
                  key={loc.id}
                  className="flex items-center gap-3 px-3 py-2 hover:bg-surface-secondary/60 cursor-pointer border-b border-border-default last:border-0 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={labelSelections.includes(loc.id)}
                    onChange={() => toggleSelection(loc.id)}
                    className="rounded border-border-default text-secondary-500 focus:ring-secondary-500 shrink-0"
                  />
                  <span className="font-mono text-xs font-medium text-foreground flex-1 truncate">
                    {loc.display_code}
                  </span>
                  {loc.stock_count > 0 && (
                    <span className="text-[10px] text-foreground-muted shrink-0">{loc.stock_count}</span>
                  )}
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

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
              <input
                type="number"
                value={labelCopies}
                onChange={e => setLabelCopies(e.target.value)}
                className="w-16 px-2 py-1.5 rounded-lg border border-border-default bg-surface text-foreground text-xs text-center focus:outline-none focus:ring-2 focus:ring-secondary-500 focus:border-transparent transition-colors"
                min={1}
                max={50}
              />
            </div>
            {locations.length > 0 && (
              <button
                onClick={() =>
                  onGenerate(
                    locations.map(l => l.id),
                    parseInt(labelCopies) || 1,
                    `shelf-labels-all-${new Date().toISOString().slice(0, 10)}.pdf`
                  )
                }
                disabled={generating}
                className="px-4 py-1.5 rounded-lg text-sm font-medium border border-border-default bg-surface hover:bg-surface-secondary text-foreground transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                All ({locations.length})
              </button>
            )}
            <button
              onClick={() =>
                onGenerate(
                  labelSelections,
                  parseInt(labelCopies) || 1,
                  `shelf-labels-${new Date().toISOString().slice(0, 10)}.pdf`
                )
              }
              disabled={generating || labelSelections.length === 0}
              className="px-4 py-1.5 rounded-lg text-sm font-medium bg-secondary-500 hover:bg-secondary-600 dark:bg-secondary-400 dark:hover:bg-secondary-300 text-white dark:text-secondary-900 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {generating ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Generating…
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  Download PDF
                </>
              )}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {selectedLocs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <svg
                className="w-10 h-10 text-foreground-muted/40 mb-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M7 7h.01M7 3h5l4.586 4.586a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-4-4a2 2 0 010-2.828L7 3z"
                />
              </svg>
              <p className="text-sm font-medium text-foreground-secondary">No labels selected</p>
              <p className="text-xs text-foreground-muted mt-1">Check locations on the left to add them here</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-3">
              {selectedLocs.map(loc => (
                <div
                  key={loc.id}
                  className="relative group/card bg-white dark:bg-neutral-900 rounded-lg border border-border-default shadow-sm aspect-[10/7] flex flex-col items-center justify-center p-2 overflow-hidden"
                >
                  <button
                    onClick={() => toggleSelection(loc.id)}
                    className="absolute top-1 right-1 opacity-0 group-hover/card:opacity-100 w-4 h-4 flex items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30 text-red-500 hover:bg-red-200 transition-all text-[10px] leading-none"
                    title="Remove"
                  >
                    ×
                  </button>
                  <span className="font-mono font-bold text-[11px] text-foreground text-center leading-tight">
                    {loc.display_code}
                  </span>
                  <span className="text-[9px] text-foreground-muted mt-0.5 text-center truncate w-full px-1">
                    {loc.warehouse_name}
                  </span>
                  {loc.stock_count > 0 && (
                    <span className="mt-1 text-[9px] font-medium text-secondary-500 dark:text-secondary-400">
                      {loc.stock_count} SKU{loc.stock_count !== 1 ? 's' : ''}
                    </span>
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
