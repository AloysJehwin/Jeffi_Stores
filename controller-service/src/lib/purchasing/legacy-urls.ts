// Suppliers and purchase orders moved off the Inventory page, and the stock ledger's
// sub-views became Inventory tabs. Maps an old /admin/inventory query to its new home.
export function legacyInventoryRedirect(params: Record<string, string | undefined>): string | null {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v != null && k !== 'tab') q.set(k, v)
  const tab = params.tab
  const with_ = (path: string, extra: Record<string, string>) => {
    for (const [k, v] of Object.entries(extra)) q.set(k, v)
    return `${path}?${q}`
  }
  if (tab === 'suppliers') return with_('/admin/suppliers', { tab: 'suppliers' })
  if (tab === 'po' || tab === 'pos' || (!tab && params.po)) return with_('/admin/purchase-orders', { tab: 'orders' })
  if (tab === 'stock') {
    const view = q.get('stock_view') === 'valuation' ? 'valuation' : 'ledger'
    q.delete('stock_view')
    return with_('/admin/inventory', { tab: view })
  }
  return null
}
