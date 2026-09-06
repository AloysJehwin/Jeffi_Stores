export const dynamic = 'force-static'

const navLinks = ['Home', 'Shop', 'Categories', 'About']

const categories = [
  { name: 'Electronics', icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
  { name: 'Fashion',     icon: 'M16 4l4 4-4 3v9H8v-9L4 8l4-4 2 2h4l2-2z' },
  { name: 'Home',        icon: 'M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3v-6h6v6h3a1 1 0 001-1V10' },
  { name: 'Kitchen',     icon: 'M12 3v9m0 0a3 3 0 003-3V4a1 1 0 00-1-1M12 12a3 3 0 01-3-3V4a1 1 0 011-1m8 0v18M18 3v6a1 1 0 001 1' },
  { name: 'Sports',      icon: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 010 18M12 3a15 15 0 000 18' },
  { name: 'Beauty',      icon: 'M9 3h6l1 4H8l1-4zM8 7h8v3a4 4 0 01-8 0V7zM12 14v7m-3 0h6' },
]

const products = [
  { name: 'Wireless Headphones',    cat: 'Electronics', price: 'Rs. 2,499', mrp: 'Rs. 3,199', off: '22% off', rating: 4.6, reviews: 214 },
  { name: 'Cotton Casual Shirt',    cat: 'Fashion',     price: 'Rs. 899',   mrp: 'Rs. 1,299', off: '31% off', rating: 4.3, reviews: 128 },
  { name: 'Stainless Steel Cookware',cat: 'Kitchen',    price: 'Rs. 1,299', mrp: null,        off: null,      rating: 4.8, reviews: 96  },
  { name: 'Fitness Exercise Mat',   cat: 'Sports',      price: 'Rs. 649',   mrp: 'Rs. 899',   off: '28% off', rating: 4.5, reviews: 340 },
  { name: 'Premium Bedsheet Set',   cat: 'Home',        price: 'Rs. 1,099', mrp: 'Rs. 1,499', off: '27% off', rating: 4.7, reviews: 152 },
  { name: 'Ceramic Mug Set',        cat: 'Kitchen',     price: 'Rs. 549',   mrp: null,        off: null,      rating: 4.4, reviews: 78  },
  { name: 'LED Desk Lamp',          cat: 'Home',        price: 'Rs. 799',   mrp: 'Rs. 1,049', off: '24% off', rating: 4.6, reviews: 203 },
  { name: 'Canvas Backpack',        cat: 'Fashion',     price: 'Rs. 1,199', mrp: 'Rs. 1,699', off: '29% off', rating: 4.5, reviews: 187 },
]

const trust = [
  { title: 'Free Shipping', sub: 'On orders over Rs. 999', icon: 'M3 9l1-5h11l1 3h4l1 4v5h-2M3 9v7h2m0 0a2 2 0 104 0m-4 0h8m4 0a2 2 0 104 0m-4 0h.01M13 16V4' },
  { title: 'Secure Payments', sub: '100% protected checkout', icon: 'M12 3l7 4v5c0 4.5-3 8-7 9-4-1-7-4.5-7-9V7l7-4zM9 12l2 2 4-4' },
  { title: 'Easy Returns', sub: '7-day hassle-free returns', icon: 'M4 4v6h6M20 20v-6h-6M20 8a8 8 0 00-14.9-3M4 16a8 8 0 0014.9 3' },
  { title: '24/7 Support', sub: 'Always here to help', icon: 'M18 13a6 6 0 01-6 6H8l-4 2v-8a6 6 0 016-6h2a6 6 0 016 6z' },
]

function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} className={`w-3 h-3 ${i <= Math.round(rating) ? 'text-amber-400' : 'text-border-default'}`} fill="currentColor" viewBox="0 0 20 20">
          <path d="M9.05 2.93c.3-.92 1.6-.92 1.9 0l1.28 3.94a1 1 0 00.95.69h4.15c.97 0 1.37 1.24.59 1.81l-3.36 2.44a1 1 0 00-.36 1.12l1.28 3.94c.3.92-.75 1.69-1.54 1.12l-3.35-2.44a1 1 0 00-1.18 0l-3.35 2.44c-.79.57-1.84-.2-1.54-1.12l1.28-3.94a1 1 0 00-.36-1.12L2.03 9.37c-.78-.57-.38-1.81.59-1.81h4.15a1 1 0 00.95-.69l1.28-3.94z" />
        </svg>
      ))}
    </div>
  )
}

export default function PreviewStorefront() {
  return (
    <div className="light-scope bg-white min-h-screen font-sans text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-border-default">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-4">
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center text-white font-black text-sm">N</div>
            <span className="text-lg font-black tracking-tight text-foreground">Nova Shop</span>
          </div>
          <nav className="hidden md:flex items-center gap-6 ml-4">
            {navLinks.map((l, i) => (
              <a key={l} href="#" className={`text-sm font-medium ${i === 0 ? 'text-primary-600' : 'text-foreground-secondary hover:text-foreground'}`}>{l}</a>
            ))}
          </nav>
          <div className="ml-auto hidden sm:flex items-center flex-1 max-w-xs h-9 rounded-full bg-surface-secondary border border-border-default px-3 gap-2">
            <svg className="w-4 h-4 text-foreground-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <span className="text-sm text-foreground-muted">Search products…</span>
          </div>
          <button className="relative flex-shrink-0 p-2 rounded-lg hover:bg-surface-secondary">
            <svg className="w-6 h-6 text-foreground-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.29 2.29A1 1 0 005.4 17H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
            <span className="absolute -top-0.5 -right-0.5 w-5 h-5 rounded-full bg-accent-500 text-white text-[10px] font-bold flex items-center justify-center">3</span>
          </button>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-6">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-primary-500 to-accent-500 px-6 sm:px-12 py-12 sm:py-16 text-white shadow-sm">
          <div className="absolute inset-0 opacity-20 bg-[radial-gradient(ellipse_at_80%_50%,white,transparent_60%)]" />
          <div className="relative z-10 max-w-lg">
            <span className="inline-block bg-white/20 text-white text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full mb-4 ring-1 ring-white/30">Limited time</span>
            <h1 className="text-3xl sm:text-5xl font-black leading-tight">Season Sale — up to 40% off</h1>
            <p className="mt-3 text-white/85 text-sm sm:text-base">Refresh your everyday with handpicked deals across every category. Free shipping on orders over Rs. 999.</p>
            <button className="mt-6 px-6 py-3 rounded-xl bg-white text-primary-600 text-sm font-bold shadow-lg hover:bg-white/90 transition">Shop Now →</button>
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-black tracking-tight text-foreground">Shop by Category</h2>
          <a href="#" className="text-sm font-semibold text-primary-600">View all →</a>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          {categories.map((c) => (
            <a key={c.name} href="#" className="flex flex-col items-center gap-2 p-4 rounded-xl bg-surface-secondary border border-border-default hover:border-primary-500/50 hover:shadow-sm transition">
              <div className="w-11 h-11 rounded-full bg-primary-500/10 flex items-center justify-center">
                <svg className="w-5 h-5 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d={c.icon} /></svg>
              </div>
              <span className="text-xs font-semibold text-foreground text-center leading-tight">{c.name}</span>
            </a>
          ))}
        </div>
      </section>

      {/* Featured Products */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-10">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-accent-600">Handpicked</p>
            <h2 className="text-xl font-black tracking-tight text-foreground">Featured Products</h2>
          </div>
          <a href="#" className="text-sm font-semibold text-primary-600">View all →</a>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {products.map((p) => (
            <div key={p.name} className="group bg-white rounded-xl border border-border-default overflow-hidden flex flex-col hover:shadow-md transition">
              <div className="relative aspect-square bg-surface-secondary flex items-center justify-center">
                <svg className="w-12 h-12 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                {p.off && <span className="absolute top-2 left-2 bg-accent-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">{p.off}</span>}
                <button className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/90 border border-border-default flex items-center justify-center text-foreground-muted hover:text-accent-500 shadow-sm">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
                </button>
              </div>
              <div className="p-3 flex flex-col gap-1.5 flex-1">
                <span className="text-[11px] text-foreground-muted">{p.cat}</span>
                <span className="text-sm font-semibold text-foreground leading-snug line-clamp-2">{p.name}</span>
                <div className="flex items-center gap-1.5">
                  <Stars rating={p.rating} />
                  <span className="text-[11px] text-foreground-muted">({p.reviews})</span>
                </div>
                <div className="flex items-baseline gap-2 mt-auto pt-1">
                  <span className="text-base font-black text-foreground">{p.price}</span>
                  {p.mrp && <span className="text-xs text-foreground-muted line-through">{p.mrp}</span>}
                </div>
                <button className="mt-1 w-full py-2 rounded-lg bg-primary-500 text-white text-xs font-bold hover:bg-primary-600 transition">Add to Cart</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Trust strip */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12 mt-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {trust.map((t) => (
            <div key={t.title} className="flex items-center gap-3 p-4 rounded-xl bg-surface-secondary border border-border-default">
              <div className="w-10 h-10 rounded-full bg-primary-500/10 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d={t.icon} /></svg>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-foreground leading-tight">{t.title}</p>
                <p className="text-xs text-foreground-muted mt-0.5">{t.sub}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border-default bg-surface-secondary">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center text-white font-black text-xs">N</div>
            <span className="text-sm font-bold text-foreground">Nova Shop</span>
          </div>
          <p className="text-xs text-foreground-muted">© 2026 Nova Shop. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}
