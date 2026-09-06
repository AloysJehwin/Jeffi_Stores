// Static preview components for landing-page BrowserFrame slots.
// Pure JSX, no hooks, no fetches — dummy data only.
// All wrapped inside .dark so CSS var tokens (surface, foreground, etc) resolve to dark values.

// ── Storefront (real homepage layout) ────────────────────────────────────────
export function StorefrontPreview() {
  const products = [
    { name: 'Wireless Headphones Pro', price: '₹2,499', mrp: '₹3,199', off: '22% off', cat: 'Electronics' },
    { name: 'Linen Kurta Set', price: '₹899', mrp: '₹1,299', off: '31% off', cat: 'Fashion' },
    { name: 'Cast Iron Kadai 25cm', price: '₹1,299', mrp: null, off: null, cat: 'Kitchen' },
    { name: 'Yoga Mat Pro 6mm', price: '₹649', mrp: '₹899', off: '28% off', cat: 'Sports' },
  ]
  const cats = ['Electronics', 'Fashion', 'Kitchen', 'Sports', 'Books', 'Beauty', 'Toys', 'Industrial']
  return (
    <div className="bg-[#0d0e14] text-[#f3f4f6] text-[11px] select-none overflow-hidden font-sans">
      {/* Topbar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[#1a1b23] border-b border-[#3f4150]">
        <div className="w-5 h-5 rounded-md bg-gradient-to-br from-amber-500 to-green-600 flex items-center justify-center text-[9px] font-black text-white">J</div>
        <span className="font-bold text-xs text-[#f3f4f6]">Jeffi Store</span>
        <div className="ml-auto flex items-center gap-3">
          <div className="h-5 w-28 rounded-full bg-[#2e303b] border border-[#3f4150] flex items-center px-2 gap-1">
            <svg className="w-3 h-3 text-[#aeb4c0]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <span className="text-[9px] text-[#6b7280]">Search products…</span>
          </div>
          <svg className="w-4 h-4 text-[#aeb4c0]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" /></svg>
        </div>
      </div>

      {/* Hero carousel */}
      <div className="relative overflow-hidden bg-gradient-to-r from-[#1a2a0d] via-[#1e2b10] to-[#0d1a1a] px-5 py-6">
        <div className="absolute inset-0 opacity-30 bg-[radial-gradient(ellipse_at_80%_50%,rgba(92,170,0,0.4),transparent)]" />
        <div className="relative z-10">
          <span className="inline-block bg-green-500/20 text-green-400 text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full mb-2 ring-1 ring-green-500/30">New arrivals</span>
          <h2 className="text-lg font-black text-white leading-tight">Fresh picks<br /><span className="text-green-400">just landed.</span></h2>
          <button className="mt-3 px-3 py-1.5 rounded-lg bg-green-500 text-[#0d0e14] text-[10px] font-bold shadow-lg shadow-green-500/30">Shop now →</button>
        </div>
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
          {[0,1,2].map(i => <span key={i} className={`w-1.5 h-1.5 rounded-full ${i===0?'bg-green-400':'bg-white/20'}`}/>)}
        </div>
      </div>

      {/* Trust strip */}
      <div className="bg-[#1a1b23] border-y border-[#3f4150] grid grid-cols-4 divide-x divide-[#3f4150]">
        {['Free delivery ₹499+', 'GST Invoice', '10,000+ items', 'Cash on delivery'].map((t) => (
          <div key={t} className="py-2 px-1.5 text-center">
            <span className="text-[8px] text-[#aeb4c0] font-medium leading-tight block">{t}</span>
          </div>
        ))}
      </div>

      {/* Categories */}
      <div className="px-3 py-3 bg-[#0d0e14]">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <div className="w-0.5 h-4 bg-amber-500 rounded-full" />
            <span className="text-xs font-black text-[#f3f4f6]">Shop by Category</span>
          </div>
          <span className="text-[9px] text-green-400 font-semibold">View All →</span>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {cats.map(c => (
            <div key={c} className="flex flex-col items-center gap-1 p-1.5 rounded-lg bg-[#1a1b23] border border-[#3f4150] hover:border-green-500/40">
              <div className="w-6 h-6 rounded-md bg-amber-500/10 flex items-center justify-center">
                <svg className="w-3 h-3 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
              </div>
              <span className="text-[8px] font-bold text-[#d1d5db] leading-tight text-center">{c}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Featured Products */}
      <div className="px-3 py-3 bg-[#13141c]">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-1.5">
            <div className="w-0.5 h-4 bg-green-500 rounded-full" />
            <div>
              <p className="text-[8px] text-green-400 font-black uppercase tracking-widest">Handpicked</p>
              <span className="text-xs font-black text-[#f3f4f6]">Featured Products</span>
            </div>
          </div>
          <span className="text-[9px] text-green-400 font-semibold">View All →</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {products.map(p => (
            <div key={p.name} className="bg-[#1a1b23] rounded-lg border border-[#3f4150] overflow-hidden flex flex-col">
              <div className="relative aspect-[4/3] bg-[#2e303b] flex items-center justify-center border-b border-[#3f4150]">
                <svg className="w-8 h-8 text-[#4a4c5e]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                {p.off && <span className="absolute top-1.5 left-1.5 bg-green-500/90 text-[#0d0e14] text-[8px] font-bold px-1.5 py-0.5 rounded-full">{p.off}</span>}
              </div>
              <div className="p-2 flex flex-col gap-1">
                <span className="text-[10px] font-semibold text-[#f3f4f6] line-clamp-2">{p.name}</span>
                <span className="text-[8px] text-[#6b7280]">{p.cat}</span>
                <div className="flex items-baseline gap-1 mt-auto">
                  <span className="text-xs font-bold text-amber-400">{p.price}</span>
                  {p.mrp && <span className="text-[8px] text-[#6b7280] line-through">{p.mrp}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Admin Dashboard ───────────────────────────────────────────────────────────
export function DashboardPreview() {
  const bars = [38, 55, 47, 72, 58, 85, 68, 74, 62, 88, 79, 92, 71, 83]
  const kpis = [
    { label: 'Revenue',        value: 'Rs. 1,24,500', sub: 'Prev: Rs. 1,05,200', pct: '+18%', pos: true,  bg: 'bg-accent-500/10',  tc: 'text-accent-600 dark:text-accent-400'  },
    { label: 'Orders',         value: '342',           sub: 'Prev: 276',          pct: '+24%', pos: true,  bg: 'bg-blue-500/10',    tc: 'text-blue-600 dark:text-blue-400'      },
    { label: 'Avg Order Value',value: 'Rs. 364',       sub: 'Prev: Rs. 381',      pct: '-4%',  pos: false, bg: 'bg-amber-500/10',   tc: 'text-amber-600 dark:text-amber-400'    },
    { label: 'Customers',      value: '218',           sub: 'Prev: 194',          pct: '+12%', pos: true,  bg: 'bg-violet-500/10',  tc: 'text-violet-600 dark:text-violet-400'  },
  ]
  return (
    <div className="bg-surface text-foreground text-[11px] select-none font-sans overflow-hidden">
      {/* topbar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-surface-elevated border-b border-border-default">
        <div>
          <h1 className="font-bold text-sm text-foreground">Welcome back, Aloys</h1>
          <p className="text-[9px] text-foreground-secondary">Store at a glance · Last 30 days</p>
        </div>
        <div className="flex items-center bg-surface-secondary border border-border-default rounded-xl p-0.5 gap-0.5">
          {['7d','30d','90d','1y'].map((r,i) => (
            <span key={r} className={`px-2 py-1 rounded-lg text-[9px] font-semibold ${i===1 ? 'bg-accent-500 text-white shadow-sm' : 'text-foreground-secondary'}`}>{r}</span>
          ))}
        </div>
      </div>

      <div className="p-3 space-y-3">
        {/* KPI grid — exact StatCard pattern */}
        <div className="grid grid-cols-2 gap-2">
          {kpis.map(k => (
            <div key={k.label} className={`${k.bg} rounded-xl border border-border-default p-3`}>
              <p className="text-[9px] text-foreground-secondary">{k.label}</p>
              <p className="text-base font-bold text-foreground mt-0.5">{k.value}</p>
              <div className="flex items-center gap-1.5 mt-1">
                <span className={`text-[9px] font-semibold ${k.pos ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{k.pct}</span>
                <span className="text-[8px] text-foreground-muted truncate">{k.sub}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Revenue trend */}
        <div className="bg-surface-elevated rounded-xl border border-border-default p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold text-foreground">Revenue & Orders</span>
            <span className="text-[9px] text-accent-600 dark:text-accent-400">View Orders →</span>
          </div>
          <div className="flex items-end gap-0.5 h-14">
            {bars.map((h, i) => (
              <div key={i} className="flex-1 rounded-t bg-accent-500/60" style={{ height: `${h}%` }} />
            ))}
          </div>
        </div>

        {/* Quick actions */}
        <div className="bg-surface-elevated rounded-xl border border-border-default p-3">
          <p className="text-[9px] text-foreground-muted uppercase tracking-widest mb-2">Quick Actions</p>
          <div className="grid grid-cols-3 gap-1.5">
            {['New Product', 'Cash Sale', 'Quotation', 'New PO', 'Orders', 'Packing Slips'].map((a, i) => (
              <div key={a} className={`rounded-lg border px-2 py-1.5 text-center text-[9px] font-medium ${i === 0 ? 'bg-accent-500/15 border-accent-500/30 text-accent-600 dark:text-accent-400' : 'bg-surface-secondary border-border-default text-foreground-secondary'}`}>{a}</div>
            ))}
          </div>
        </div>

        {/* Needs attention */}
        <div className="bg-surface-elevated rounded-xl border border-border-default p-3">
          <p className="text-[9px] text-foreground-muted uppercase tracking-widest mb-2">Needs Attention</p>
          <div className="flex flex-wrap gap-1.5">
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-semibold bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />5 pending orders
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-semibold bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" />3 low stock items
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Products ──────────────────────────────────────────────────────────────────
export function ProductsPreview() {
  const rows = [
    { name: 'Wireless Headphones Pro', sku: 'WH-001', cat: 'Electronics', price: 'Rs. 2,499', stock: 24, active: true,  featured: true  },
    { name: 'Linen Kurta Set — Men',   sku: 'KU-012', cat: 'Fashion',     price: 'Rs. 899',   stock: 8,  active: true,  featured: false },
    { name: 'Cast Iron Kadai 25cm',    sku: 'KI-034', cat: 'Kitchen',     price: 'Rs. 1,299', stock: 0,  active: true,  featured: false },
    { name: 'Yoga Mat Pro 6mm',        sku: 'SP-007', cat: 'Sports',      price: 'Rs. 649',   stock: 52, active: true,  featured: true  },
    { name: 'Cotton Bedsheet Set',     sku: 'HM-019', cat: 'Home',        price: 'Rs. 1,099', stock: 15, active: false, featured: false },
  ]
  return (
    <div className="bg-surface text-foreground text-[11px] select-none font-sans overflow-hidden">
      {/* header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-surface-elevated border-b border-border-default">
        <div>
          <span className="font-bold text-sm text-foreground">Products</span>
          <span className="ml-2 text-[9px] text-foreground-secondary">Manage your product inventory</span>
        </div>
        <button className="px-3 py-1 rounded-lg bg-accent-600 text-white text-[10px] font-bold">+ Add Product</button>
      </div>

      {/* stats banner — exact same classes as real ProductsStats */}
      <div className="mx-3 mt-3">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-gradient-to-r from-primary-500 to-accent-500 p-4 rounded-lg shadow-sm flex flex-col justify-between text-white">
            <div>
              <p className="text-white/80 text-sm">Inventory Stock Value</p>
              <p className="text-2xl font-bold mt-1">Rs. 8,42,350.00</p>
            </div>
            <div className="grid grid-cols-4 gap-2 mt-3">
              {[['247','Total'],['198','Active'],['4/6','Featured'],['12','Categories']].map(([v,l]) => (
                <div key={l} className="rounded-lg bg-white/15 backdrop-blur-sm px-2 py-2">
                  <p className="text-base font-bold leading-none">{v}</p>
                  <p className="text-[10px] text-white/80 mt-1">{l}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* search + filter */}
      <div className="px-3 mt-3 flex gap-2">
        <div className="flex-1 h-7 rounded-lg bg-surface-elevated border border-border-default flex items-center px-2 gap-1">
          <svg className="w-3 h-3 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <span className="text-[9px] text-foreground-muted">Search by name or SKU…</span>
        </div>
        {['Category', 'Status'].map(f => (
          <div key={f} className="h-7 px-2 rounded-lg bg-surface-elevated border border-border-default flex items-center text-[9px] text-foreground-secondary gap-1">
            {f}<svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
          </div>
        ))}
      </div>

      {/* table — exact same wrapper classes as real page */}
      <div className="mt-3 mx-3 mb-3 bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden">
        <table className="min-w-full divide-y divide-border-default">
          <thead className="bg-surface-secondary">
            <tr>
              {['Product','Category','Price','Stock','Status'].map(h => (
                <th key={h} className="px-3 py-2 text-left text-[9px] font-semibold text-foreground-secondary uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-default">
            {rows.map(r => (
              <tr key={r.sku} className="hover:bg-surface-secondary/50">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-6 h-6 rounded bg-surface-secondary border border-border-default flex-shrink-0 flex items-center justify-center">
                      <svg className="w-3 h-3 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14" /></svg>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] font-medium text-foreground truncate">{r.name}{r.featured && <span className="ml-1 text-amber-400 text-[8px]">★</span>}</div>
                      <div className="text-[8px] text-foreground-muted font-mono">{r.sku}</div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2 text-[9px] text-foreground-secondary">{r.cat}</td>
                <td className="px-3 py-2 text-[10px] font-semibold text-foreground">{r.price}</td>
                <td className="px-3 py-2 text-[10px] font-semibold text-foreground">{r.stock}</td>
                <td className="px-3 py-2">
                  <span className={`px-1.5 py-0.5 text-[9px] font-semibold rounded-full ${r.active && r.stock > 0 ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300' : r.stock === 0 ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300' : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300'}`}>
                    {r.active ? (r.stock === 0 ? 'Out of Stock' : 'Active') : 'Inactive'}
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

// ── Orders ────────────────────────────────────────────────────────────────────
export function OrdersPreview() {
  const rows = [
    { id: '1042', customer: 'Priya Sharma',   amount: 'Rs. 2,499.00', status: 'shipped',    payment: 'paid',    src: 'online'    },
    { id: '1041', customer: 'Rahul Mehta',    amount: 'Rs. 1,799.00', status: 'delivered',  payment: 'paid',    src: 'online'    },
    { id: '1040', customer: 'Ananya Iyer',    amount: 'Rs. 649.00',   status: 'processing', payment: 'paid',    src: 'business'  },
    { id: '1039', customer: 'Karthik Nair',   amount: 'Rs. 3,148.00', status: 'pending',    payment: 'pending', src: 'online'    },
    { id: '1038', customer: 'Deepa Krishnan', amount: 'Rs. 899.00',   status: 'cancelled',  payment: 'refunded',src: 'cash_sale' },
  ]

  function statusCls(s: string) {
    if (s === 'delivered') return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
    if (s === 'processing' || s === 'shipped') return 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'
    if (s === 'cancelled') return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
    return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300'
  }
  function sourceCls(s: string) {
    if (s === 'online') return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
    if (s === 'business') return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
    return 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
  }
  function paymentCls(s: string) {
    if (s === 'paid') return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
    if (s === 'refunded') return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
    return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300'
  }

  return (
    <div className="bg-surface text-foreground text-[11px] select-none font-sans overflow-hidden">
      {/* header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-surface-elevated border-b border-border-default">
        <span className="font-bold text-sm text-foreground">Orders</span>
      </div>

      {/* stats banner — exact same classes as real OrdersStats */}
      <div className="mx-3 mt-3">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-gradient-to-r from-primary-500 to-accent-500 p-4 rounded-lg shadow-sm flex flex-col justify-between text-white">
            <div>
              <p className="text-white/80 text-sm">Total Revenue</p>
              <p className="text-2xl font-bold mt-1">Rs. 3,84,250.00</p>
            </div>
            <div className="grid grid-cols-4 gap-2 mt-3">
              {[['342','Total'],['17','Pending'],['28','Processing'],['297','Completed']].map(([v,l]) => (
                <div key={l} className="rounded-lg bg-white/15 backdrop-blur-sm px-2 py-2">
                  <p className="text-base font-bold leading-none">{v}</p>
                  <p className="text-[10px] text-white/80 mt-1">{l}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* table — exact same wrapper as real page */}
      <div className="mt-3 mx-3 mb-3 bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden">
        <table className="min-w-full divide-y divide-border-default">
          <thead className="bg-surface-secondary">
            <tr>
              {['Order ID','Source','Customer','Amount','Status','Payment'].map(h => (
                <th key={h} className="px-3 py-2 text-left text-[9px] font-semibold text-foreground-secondary uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-default">
            {rows.map(r => (
              <tr key={r.id} className="hover:bg-surface-secondary/50">
                <td className="px-3 py-2 text-[10px] font-semibold text-foreground">#{r.id}</td>
                <td className="px-3 py-2"><span className={`px-1.5 py-0.5 text-[9px] font-medium rounded ${sourceCls(r.src)}`}>{r.src === 'online' ? 'Online' : r.src === 'business' ? 'Business' : 'Cash Sale'}</span></td>
                <td className="px-3 py-2 text-[10px] text-foreground">{r.customer}</td>
                <td className="px-3 py-2 text-[10px] font-semibold text-foreground">{r.amount}</td>
                <td className="px-3 py-2"><span className={`px-1.5 py-0.5 text-[9px] font-semibold rounded-full ${statusCls(r.status)}`}>{r.status}</span></td>
                <td className="px-3 py-2"><span className={`px-1.5 py-0.5 text-[9px] font-semibold rounded-full ${paymentCls(r.payment)}`}>{r.payment}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Shipment Tracking ─────────────────────────────────────────────────────────
export function ShipmentPreview() {
  const events = [
    { time: '10:42 AM',  label: 'Out for delivery', loc: 'Bengaluru South Hub', done: true  },
    { time: '07:15 AM',  label: 'Arrived at hub',   loc: 'Bengaluru South Hub', done: true  },
    { time: 'Yesterday', label: 'In transit',        loc: 'Chennai Facility',    done: true  },
    { time: '2 days ago',label: 'Picked up',         loc: 'Coimbatore Pickup',   done: false },
  ]
  const orders = [
    { id: '1042', awb: 'DEL5892341', customer: 'Priya Sharma', dest: 'Bengaluru', status: 'Out for Delivery', cls: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'   },
    { id: '1039', awb: 'DEL5892289', customer: 'Karthik Nair', dest: 'Chennai',   status: 'In Transit',       cls: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300' },
    { id: '1037', awb: 'DEL5891976', customer: 'Arjun Kumar',  dest: 'Mumbai',    status: 'Picked Up',        cls: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'  },
  ]
  return (
    <div className="bg-surface text-foreground text-[11px] select-none font-sans overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-surface-elevated border-b border-border-default">
        <span className="font-bold text-sm text-foreground">Delhivery · Shipments</span>
        <span className="px-2 py-0.5 text-[9px] font-semibold rounded-full bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300">3 active</span>
      </div>

      <div className="px-3 mt-3 space-y-2">
        {orders.map(o => (
          <div key={o.id} className="bg-surface-elevated rounded-lg border border-border-default p-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-[10px] text-foreground">#{o.id}</span>
                <span className="font-mono text-[9px] text-foreground-muted">{o.awb}</span>
              </div>
              <div className="text-[9px] text-foreground-secondary mt-0.5">{o.customer} · {o.dest}</div>
            </div>
            <span className={`px-1.5 py-0.5 text-[9px] font-semibold rounded-full ${o.cls}`}>{o.status}</span>
          </div>
        ))}
      </div>

      {/* Tracking timeline */}
      <div className="mx-3 mt-3 mb-3 bg-surface-elevated rounded-lg border border-border-default p-3">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] font-semibold text-foreground">AWB: DEL5892341</span>
          <span className="px-1.5 py-0.5 text-[9px] font-semibold rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300">Out for Delivery</span>
        </div>
        <div className="space-y-2.5">
          {events.map((e, i) => (
            <div key={i} className="flex gap-3 items-start">
              <div className="flex flex-col items-center shrink-0">
                <span className={`w-2.5 h-2.5 rounded-full border-2 mt-0.5 ${e.done ? 'bg-accent-500 border-accent-500' : 'bg-surface border-border-default'}`} />
                {i < events.length - 1 && <span className="w-px flex-1 bg-border-default mt-1" style={{ minHeight: 10 }} />}
              </div>
              <div className="pb-1">
                <div className={`text-[10px] font-semibold ${e.done ? 'text-foreground' : 'text-foreground-muted'}`}>{e.label}</div>
                <div className="text-[8px] text-foreground-muted">{e.loc} · {e.time}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── GST Invoice ───────────────────────────────────────────────────────────────
export function GstInvoicePreview() {
  const items = [
    { desc: 'Wireless Headphones Pro × 1', hsn: '8518', taxable: 'Rs. 2,118', gst: '18%', amount: 'Rs. 2,499' },
    { desc: 'Yoga Mat Pro × 2',            hsn: '9506', taxable: 'Rs. 1,099', gst: '18%', amount: 'Rs. 1,298' },
  ]
  return (
    <div className="bg-surface text-foreground text-[11px] select-none font-sans overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-surface-elevated border-b border-border-default">
        <div className="flex items-center gap-2">
          <svg className="w-3.5 h-3.5 text-foreground-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
          <span className="font-bold text-sm text-foreground">Tax Invoice — INV-2026-1042</span>
        </div>
        <span className="px-2 py-0.5 text-[9px] font-semibold rounded-full bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300">Paid</span>
      </div>

      <div className="p-3 space-y-3">
        {/* Parties */}
        <div className="flex items-start justify-between gap-3">
          <div className="bg-surface-elevated rounded-lg border border-border-default p-2.5 flex-1">
            <p className="text-[8px] text-foreground-muted uppercase tracking-widest mb-1">Seller</p>
            <div className="font-bold text-[10px] text-foreground">Acme Hardware Pvt Ltd</div>
            <div className="text-[8px] text-foreground-muted mt-0.5">GSTIN: 29AAAAA0000A1Z5</div>
            <div className="text-[8px] text-foreground-secondary">123 Industrial Area, Bengaluru</div>
          </div>
          <div className="bg-surface-elevated rounded-lg border border-border-default p-2.5 flex-1">
            <p className="text-[8px] text-foreground-muted uppercase tracking-widest mb-1">Bill To</p>
            <div className="font-bold text-[10px] text-foreground">Priya Sharma</div>
            <div className="text-[8px] text-foreground-secondary mt-0.5">Chennai, Tamil Nadu</div>
            <div className="text-[8px] text-foreground-muted">600001</div>
          </div>
        </div>

        {/* Items table — exact same pattern as real invoices table */}
        <div className="bg-surface-elevated rounded-lg border border-border-default overflow-hidden">
          <table className="min-w-full divide-y divide-border-default">
            <thead className="bg-surface-secondary">
              <tr>
                {['Item','HSN','Taxable','GST','Amount'].map(h => (
                  <th key={h} className="px-2 py-2 text-left text-[8px] font-semibold text-foreground-secondary uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {items.map(item => (
                <tr key={item.desc}>
                  <td className="px-2 py-2 text-[9px] text-foreground">{item.desc}</td>
                  <td className="px-2 py-2 text-[8px] text-foreground-muted font-mono">{item.hsn}</td>
                  <td className="px-2 py-2 text-[9px] text-foreground-secondary">{item.taxable}</td>
                  <td className="px-2 py-2 text-[9px] text-foreground-secondary">{item.gst}</td>
                  <td className="px-2 py-2 text-[9px] font-semibold text-foreground text-right">{item.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="bg-surface-elevated rounded-lg border border-border-default p-3 space-y-1.5">
          {[['Subtotal','Rs. 3,217'],['CGST (9%)','Rs. 289.53'],['SGST (9%)','Rs. 289.53'],['Shipping','Rs. 99.00']].map(([l,v]) => (
            <div key={l} className="flex items-center justify-between py-0.5 border-b border-border-default last:border-0">
              <span className="text-[9px] text-foreground-muted">{l}</span>
              <span className="text-[9px] text-foreground-secondary font-semibold">{v}</span>
            </div>
          ))}
          <div className="flex items-center justify-between pt-1.5">
            <span className="text-[10px] font-bold text-foreground">Total</span>
            <span className="text-sm font-black text-accent-600 dark:text-accent-400">Rs. 3,895.06</span>
          </div>
        </div>

        {/* IRN — same amber/green banner pattern as real InvoicesClient */}
        <div className="rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 px-3 py-2 flex items-center gap-2">
          <svg className="w-3 h-3 text-green-600 dark:text-green-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
          <span className="text-[9px] text-green-700 dark:text-green-400 font-semibold">IRN Generated · e-Invoice compliant</span>
        </div>
      </div>
    </div>
  )
}
