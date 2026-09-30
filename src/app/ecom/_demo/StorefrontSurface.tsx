'use client'

import { motion, AnimatePresence } from 'motion/react'
import type { ReactNode } from 'react'
import { useDemo } from './store'
import type { Product } from './store'
import { STATUS_CLASSES } from './theme'
import ProductArt from './ProductArt'

function formatRs(n: number): string {
  return `Rs. ${n.toLocaleString('en-IN')}`
}

function discountPct(price: number, mrp: number | null): number | null {
  if (!mrp || mrp <= price) return null
  return Math.round(((mrp - price) / mrp) * 100)
}

function View({ children, reduced, focusKey }: { children: ReactNode; reduced: boolean; focusKey: string }) {
  if (reduced) {
    return <div className="h-full w-full flex flex-col overflow-hidden">{children}</div>
  }
  return (
    <motion.div
      key={focusKey}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="h-full w-full flex flex-col overflow-hidden"
    >
      {children}
    </motion.div>
  )
}

function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <svg
          key={i}
          className={`w-3 h-3 ${i <= Math.round(rating) ? 'text-amber-400' : 'text-border-default'}`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path d="M9.05 2.93c.3-.92 1.6-.92 1.9 0l1.28 3.94a1 1 0 00.95.69h4.15c.97 0 1.37 1.24.59 1.81l-3.36 2.44a1 1 0 00-.36 1.12l1.28 3.94c.3.92-.75 1.69-1.54 1.12l-3.35-2.44a1 1 0 00-1.18 0l-3.35 2.44c-.79.57-1.84-.2-1.54-1.12l1.28-3.94a1 1 0 00-.36-1.12L2.03 9.37c-.78-.57-.38-1.81.59-1.81h4.15a1 1 0 00.95-.69l1.28-3.94z" />
        </svg>
      ))}
    </div>
  )
}

function StoreHeader({ cartCount }: { cartCount: number }) {
  return (
    <div className="flex items-center justify-between gap-3 flex-shrink-0">
      <div className="flex items-center gap-2">
        <span className="ecom-accent-bg w-7 h-7 rounded-lg flex items-center justify-center text-white text-sm font-black">
          N
        </span>
        <span className="text-base font-black tracking-tight text-foreground">Nova Shop</span>
      </div>
      <div className="hidden sm:flex flex-1 max-w-xs items-center gap-2 bg-surface-secondary rounded-lg px-3 py-1.5 text-foreground-muted">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
        </svg>
        <span className="text-xs">Search products</span>
      </div>
      <div className="relative flex items-center gap-1.5 text-foreground">
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
          />
        </svg>
        <span className="text-sm font-bold">{cartCount}</span>
      </div>
    </div>
  )
}

function CatalogueView({ products, onOpen }: { products: Product[]; onOpen: (id: string) => void }) {
  const visible = products.slice(0, 8)
  return (
    <>
      <div className="flex items-baseline justify-between mb-3 flex-shrink-0">
        <div>
          <p className="ecom-accent-text text-[11px] font-black uppercase tracking-widest">Handpicked</p>
          <h2 className="text-lg font-black tracking-tight text-foreground">Featured products</h2>
        </div>
        <span className="text-xs text-foreground-muted">{products.length} items</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 flex-1 min-h-0 content-start">
        {visible.map(p => {
          const off = discountPct(p.price, p.mrp)
          return (
            <button
              key={p.id}
              onClick={() => onOpen(p.id)}
              className="group text-left bg-surface rounded-2xl border border-border-default overflow-hidden flex flex-col hover:shadow-lg hover:-translate-y-0.5 transition"
            >
              <div className="relative aspect-[4/3] bg-surface-secondary overflow-hidden">
                <ProductArt category={p.category} className="w-full h-full" />
                {off !== null && (
                  <span className="ecom-accent-bg absolute top-2.5 left-2.5 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                    {off}% off
                  </span>
                )}
              </div>
              <div className="p-3.5 flex flex-col gap-1.5 flex-1">
                <span className="text-[10px] font-medium uppercase tracking-wide text-foreground-muted">
                  {p.category}
                </span>
                <span className="text-sm font-semibold text-foreground leading-snug line-clamp-1">{p.name}</span>
                <div className="flex items-center gap-1">
                  <Stars rating={p.rating} />
                  <span className="text-[10px] text-foreground-muted">({p.reviews})</span>
                </div>
                <div className="flex items-baseline gap-2 mt-auto pt-1">
                  <span className="text-base font-black text-foreground">{formatRs(p.price)}</span>
                  {p.mrp && <span className="text-[11px] text-foreground-muted line-through">{formatRs(p.mrp)}</span>}
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </>
  )
}

function ProductView({ product, onAdd }: { product: Product; onAdd: () => void }) {
  const off = discountPct(product.price, product.mrp)
  return (
    <div className="flex-1 min-h-0 grid md:grid-cols-2 gap-6 items-center">
      <div className="h-full max-h-[360px] rounded-2xl bg-surface-secondary border border-border-default overflow-hidden flex items-center justify-center p-6">
        <ProductArt category={product.category} className="w-full h-full max-w-[300px]" />
      </div>
      <div className="flex flex-col gap-3">
        <span className="text-xs text-foreground-muted">{product.category}</span>
        <h2 className="text-2xl font-black tracking-tight text-foreground leading-tight">{product.name}</h2>
        <div className="flex items-center gap-2">
          <Stars rating={product.rating} />
          <span className="text-xs text-foreground-muted">
            {product.rating} · {product.reviews} reviews
          </span>
        </div>
        <div className="flex items-baseline gap-3">
          <span className="text-3xl font-black text-foreground">{formatRs(product.price)}</span>
          {product.mrp && <span className="text-base text-foreground-muted line-through">{formatRs(product.mrp)}</span>}
          {off !== null && <span className="ecom-accent-text text-sm font-bold">{off}% off</span>}
        </div>
        <p className="text-sm text-foreground-secondary leading-relaxed">
          In stock and ready to ship. Free delivery on orders over Rs. 999.
        </p>
        <button
          onClick={onAdd}
          className="ecom-accent-bg w-full py-3 rounded-xl text-white text-sm font-bold transition mt-1"
        >
          Add to cart
        </button>
      </div>
    </div>
  )
}

function CartView({
  lines,
  total,
  onCheckout,
}: {
  lines: { productId: string; name: string; qty: number; price: number; category: string }[]
  total: number
  onCheckout: () => void
}) {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <h2 className="text-lg font-black tracking-tight text-foreground mb-3 flex-shrink-0">Your cart</h2>
      <div className="flex-1 min-h-0 flex flex-col gap-3">
        {lines.map(line => (
          <div
            key={line.productId}
            className="flex items-center gap-3 bg-surface rounded-xl border border-border-default p-3"
          >
            <div className="w-12 h-12 flex-shrink-0 rounded-lg bg-surface-secondary overflow-hidden">
              <ProductArt category={line.category} className="w-full h-full" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground truncate">{line.name}</p>
              <p className="text-[11px] text-foreground-muted">Qty {line.qty}</p>
            </div>
            <span className="text-sm font-bold text-foreground">{formatRs(line.price * line.qty)}</span>
          </div>
        ))}
      </div>
      <div className="flex-shrink-0 mt-3 border-t border-border-default pt-3 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-foreground-secondary">Total</span>
          <span className="text-xl font-black text-foreground">{formatRs(total)}</span>
        </div>
        <button
          onClick={onCheckout}
          className="ecom-accent-bg w-full py-3 rounded-xl text-white text-sm font-bold transition"
        >
          Checkout
        </button>
      </div>
    </div>
  )
}

function CheckoutView({
  total,
  order,
  onPay,
}: {
  total: number
  order: { number: string; customer: string } | null
  onPay: () => void
}) {
  if (order) {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center text-center">
        <div className="ecom-accent-bg w-14 h-14 rounded-full flex items-center justify-center text-white">
          <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="mt-4 text-xl font-black text-foreground">Order confirmed</p>
        <p className="mt-1 text-sm text-foreground-secondary">
          Order #{order.number} placed for {order.customer}.
        </p>
        <span className={`inline-block mt-3 text-[11px] font-bold px-3 py-1 rounded-full ${STATUS_CLASSES.pending}`}>
          pending
        </span>
      </div>
    )
  }
  return (
    <div className="flex-1 min-h-0 flex flex-col items-center justify-center">
      <div className="w-full max-w-sm bg-surface rounded-2xl border border-border-default p-5 flex flex-col gap-4">
        <h2 className="text-lg font-black tracking-tight text-foreground">Checkout</h2>
        <div className="flex flex-col gap-1 text-sm">
          <span className="text-foreground-muted text-xs uppercase tracking-wide">Deliver to</span>
          <span className="font-semibold text-foreground">Alex Morgan</span>
          <span className="text-foreground-secondary">14 Marina Ave, Chennai 600001</span>
        </div>
        <div className="border-t border-border-default pt-3 flex items-center justify-between">
          <span className="text-sm text-foreground-secondary">Order total</span>
          <span className="text-xl font-black text-foreground">{formatRs(total)}</span>
        </div>
        <button
          onClick={onPay}
          className="ecom-accent-bg w-full py-3 rounded-xl text-white text-sm font-bold transition"
        >
          Pay {formatRs(total)}
        </button>
        <p className="text-[11px] text-foreground-muted text-center">Secure one-tap checkout</p>
      </div>
    </div>
  )
}

export default function StorefrontSurface() {
  const { world, chapter, reducedMotion, actions } = useDemo()
  const focus = chapter?.focus ?? 'catalogue'

  const openProduct =
    (world.openProductId ? world.products.find(p => p.id === world.openProductId) : null) ?? world.products[0]

  const rawLines =
    world.cart.length > 0
      ? world.cart
      : [{ productId: openProduct.id, name: openProduct.name, qty: 1, price: openProduct.price }]
  const cartLines = rawLines.map(l => ({
    productId: l.productId,
    name: l.name,
    qty: l.qty,
    price: l.price,
    category: world.products.find(p => p.id === l.productId)?.category ?? openProduct.category,
  }))
  const cartTotal = cartLines.reduce((s, l) => s + l.price * l.qty, 0)
  const checkoutTotal = world.order ? world.order.total : cartTotal

  return (
    <div className="ecom-clean h-full w-full flex flex-col overflow-hidden bg-surface text-foreground p-4 sm:p-5">
      <StoreHeader cartCount={world.cart.length} />
      <div className="flex-1 min-h-0 mt-4 relative">
        <AnimatePresence mode="wait" initial={false}>
          <View key={focus} focusKey={focus} reduced={reducedMotion}>
            {focus === 'product' ? (
              <ProductView product={openProduct} onAdd={() => actions.addToCart(openProduct.id)} />
            ) : focus === 'cart' ? (
              <CartView lines={cartLines} total={cartTotal} onCheckout={actions.pay} />
            ) : focus === 'checkout' ? (
              <CheckoutView total={checkoutTotal} order={world.order} onPay={actions.pay} />
            ) : (
              <CatalogueView products={world.products} onOpen={actions.openProduct} />
            )}
          </View>
        </AnimatePresence>
      </div>
    </div>
  )
}
