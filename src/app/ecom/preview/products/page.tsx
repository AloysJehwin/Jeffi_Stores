export const dynamic = 'force-static'

const products = [
  { id: '1', name: 'Wireless Headphones',     sku: 'SKU-1001', cat: 'Electronics', price: 'Rs. 2,499', stock: 24,  active: true,  featured: true  },
  { id: '2', name: 'Cotton Casual Shirt',     sku: 'SKU-1012', cat: 'Apparel',     price: 'Rs. 899',   stock: 8,   active: true,  featured: false },
  { id: '3', name: 'Stainless Steel Cookware', sku: 'SKU-1034', cat: 'Kitchen',     price: 'Rs. 1,299', stock: 0,   active: true,  featured: false },
  { id: '4', name: 'Fitness Exercise Mat',    sku: 'SKU-1007', cat: 'Sports',      price: 'Rs. 649',   stock: 52,  active: true,  featured: true  },
  { id: '5', name: 'Premium Bedsheet Set',    sku: 'SKU-1019', cat: 'Home',        price: 'Rs. 1,099', stock: 15,  active: false, featured: false },
]

function stockCls(stock: number) {
  if (stock === 0) return 'bg-red-100 text-red-800'
  if (stock <= 10) return 'bg-yellow-100 text-yellow-800'
  return 'bg-green-100 text-green-800'
}
function stockLabel(stock: number) {
  if (stock === 0) return 'Out of Stock'
  if (stock <= 10) return 'Low Stock'
  return 'In Stock'
}

const chartBars = [72,58,85,63,90,44,78,95,67,82,55,88]

export default function PreviewProducts() {
  return (
    <div className="light-scope bg-white min-h-screen p-4 sm:p-6 space-y-6 font-sans">
      <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">Products</h1>

      {/* Stats banner — mirrors ProductsStats in products/page.tsx exactly */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 lg:h-56">
        <div className="bg-gradient-to-r from-primary-500 to-accent-500 p-4 sm:p-6 rounded-lg shadow-sm flex flex-col justify-between text-white">
          <div>
            <p className="text-white/80 text-sm">Inventory Stock Value</p>
            <p className="text-3xl sm:text-4xl font-bold mt-1">Rs. 8,42,350.00</p>
          </div>
          <div className="grid grid-cols-4 gap-2 sm:gap-3 mt-4">
            <div className="rounded-lg bg-white/15 backdrop-blur-sm px-2 py-2 sm:px-3 sm:py-2.5">
              <p className="text-lg sm:text-2xl font-bold leading-none">247</p>
              <p className="text-[10px] sm:text-xs text-white/80 mt-1">Total</p>
            </div>
            <div className="rounded-lg bg-white/15 backdrop-blur-sm px-2 py-2 sm:px-3 sm:py-2.5">
              <p className="text-lg sm:text-2xl font-bold leading-none">198</p>
              <p className="text-[10px] sm:text-xs text-white/80 mt-1">Active</p>
            </div>
            <div className="rounded-lg bg-white/15 backdrop-blur-sm px-2 py-2 sm:px-3 sm:py-2.5">
              <p className="text-lg sm:text-2xl font-bold leading-none">4<span className="text-xs font-normal text-white/70">/6</span></p>
              <p className="text-[10px] sm:text-xs text-white/80 mt-1">Featured</p>
            </div>
            <div className="rounded-lg bg-white/15 backdrop-blur-sm px-2 py-2 sm:px-3 sm:py-2.5">
              <p className="text-lg sm:text-2xl font-bold leading-none">12</p>
              <p className="text-[10px] sm:text-xs text-white/80 mt-1">Categories</p>
            </div>
          </div>
        </div>
        <div className="bg-surface-elevated rounded-lg border border-border-default p-4 flex flex-col">
          <p className="text-sm font-semibold text-foreground mb-3">Products by Category</p>
          <div className="flex items-end gap-1 flex-1">
            {chartBars.map((h, i) => (
              <div key={i} className="flex-1 rounded-t bg-primary-500/70" style={{ height: `${h}%` }} />
            ))}
          </div>
          <div className="flex gap-3 mt-2 text-[10px] text-foreground-muted">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-primary-500/70 inline-block" />By category</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-accent-500/70 inline-block" />By brand</span>
          </div>
        </div>
      </div>

      {/* Products table */}
      <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden">
        <table className="min-w-full divide-y divide-border-default">
          <thead className="bg-surface-secondary">
            <tr>
              {['Product','Category','Price','Stock','Status'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-foreground-secondary uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-default">
            {products.map(p => (
              <tr key={p.id} className="hover:bg-surface-secondary/50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded bg-surface-secondary border border-border-default flex items-center justify-center flex-shrink-0">
                      <svg className="w-4 h-4 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div>
                      <div className="text-sm font-medium text-foreground flex items-center gap-1">
                        {p.name}
                        {p.featured && <span className="text-amber-500 text-xs">★</span>}
                      </div>
                      <div className="text-xs text-foreground-muted font-mono">{p.sku}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-foreground-secondary">{p.cat}</td>
                <td className="px-4 py-3 text-sm font-semibold text-foreground">{p.price}</td>
                <td className="px-4 py-3 text-sm text-foreground">{p.stock}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${p.active ? stockCls(p.stock) : 'bg-yellow-100 text-yellow-800'}`}>
                    {p.active ? stockLabel(p.stock) : 'Inactive'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
