'use client'

import { Fragment, useEffect, useState } from 'react'
import Link from 'next/link'
import ImgWithSkeleton from '@/components/ui/ImgWithSkeleton'
import { useCart } from '@/contexts/CartContext'
import { useToast } from '@/contexts/ToastContext'
import { useStoreConfig } from '@/contexts/StoreConfigContext'
import {
  PDP_OPTIONS_ID,
  canAddDirectly,
  formatRupees,
  purchasableNow,
  scrollToId,
  sumPrices,
  type PdpCard,
} from './pdp'

interface FrequentlyBoughtTogetherProps {
  current: PdpCard
  launchDate?: string | Date | null
  discontinueDate?: string | Date | null
}

function Thumb({ product, dimmed }: { product: PdpCard; dimmed: boolean }) {
  const img = product.primaryImage
  return (
    <div
      className={`w-16 h-16 sm:w-20 sm:h-20 shrink-0 rounded-lg border border-border-default bg-surface overflow-hidden transition-opacity ${dimmed ? 'opacity-40' : ''}`}
    >
      {img?.image_url ? (
        <ImgWithSkeleton
          src={img.thumbnail_url || img.image_url}
          alt=""
          blurhash={img.blurhash}
          className="w-full h-full object-contain p-1"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-foreground-muted">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        </div>
      )}
    </div>
  )
}

/**
 * "Frequently bought together" from order co-purchases. Only items the cart takes without a variant
 * choice (no variants, in stock) can be ticked and added here; variant products link to their options.
 */
export default function FrequentlyBoughtTogether({
  current,
  launchDate,
  discontinueDate,
}: FrequentlyBoughtTogetherProps) {
  const [others, setOthers] = useState<PdpCard[]>([])
  const [unchecked, setUnchecked] = useState<Set<string>>(() => new Set())
  const [adding, setAdding] = useState(false)
  const { addToCart } = useCart()
  const { showToast } = useToast()
  const gstEnabled = useStoreConfig().flags.gstEnabled

  useEffect(() => {
    const ctrl = new AbortController()
    fetch(`/api/products/affinity?kind=bought&ids=${encodeURIComponent(current.id)}&limit=3`, { signal: ctrl.signal })
      .then(res => (res.ok ? res.json() : null))
      .then(data => setOthers(Array.isArray(data?.products) ? data.products : []))
      .catch(() => {})
    return () => ctrl.abort()
  }, [current.id])

  if (others.length === 0) return null

  const currentAddable = canAddDirectly(current) && purchasableNow(launchDate, discontinueDate)
  const isAddable = (p: PdpCard) => (p.id === current.id ? currentAddable : canAddDirectly(p))
  const items = [current, ...others]
  const picked = items.filter(p => isAddable(p) && !unchecked.has(p.id))
  const total = sumPrices(picked)
  const showBuyBox = others.some(canAddDirectly)

  function toggle(id: string) {
    setUnchecked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function addSelected() {
    if (picked.length === 0) return
    setAdding(true)
    let added = 0
    let failure: string | null = null
    for (const p of picked) {
      try {
        await addToCart(p.id, 1)
        added++
      } catch (err) {
        failure ??= `${p.name}: ${err instanceof Error && err.message ? err.message : 'could not be added'}`
      }
    }
    setAdding(false)
    if (!failure) showToast(added === 1 ? 'Item added to cart!' : `${added} items added to cart!`, 'success')
    else showToast(added > 0 ? `Added ${added} of ${picked.length} items. ${failure}` : failure, 'error')
  }

  return (
    <section
      aria-labelledby="fbt-heading"
      className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 sm:p-6 mb-4"
    >
      <h2 id="fbt-heading" className="text-lg sm:text-xl font-bold text-foreground mb-4">
        Frequently bought together
      </h2>
      <div className="flex flex-col lg:flex-row lg:items-start gap-5 lg:gap-8">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 sm:gap-3 overflow-x-auto pb-1 mb-4" aria-hidden="true">
            {items.map((p, i) => (
              <Fragment key={p.id}>
                {i > 0 && <span className="shrink-0 text-lg font-semibold text-foreground-muted">+</span>}
                {p.id === current.id ? (
                  <Thumb product={p} dimmed={isAddable(p) && unchecked.has(p.id)} />
                ) : (
                  <Link href={`/products/${p.slug}`} tabIndex={-1} className="shrink-0">
                    <Thumb product={p} dimmed={isAddable(p) && unchecked.has(p.id)} />
                  </Link>
                )}
              </Fragment>
            ))}
          </div>

          <ul className="space-y-2.5">
            {items.map(p => {
              const isCurrent = p.id === current.id
              const addable = isAddable(p)
              return (
                <li key={p.id} className="flex items-start gap-3 text-sm">
                  {addable ? (
                    <input
                      type="checkbox"
                      checked={!unchecked.has(p.id)}
                      onChange={() => toggle(p.id)}
                      aria-label={`Include ${p.name}`}
                      className="mt-0.5 w-4 h-4 shrink-0 accent-primary-600 cursor-pointer"
                    />
                  ) : (
                    <span className="w-4 shrink-0" aria-hidden="true" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground leading-snug">
                      {isCurrent ? (
                        <>
                          <span className="font-semibold">This item: </span>
                          {p.name}
                        </>
                      ) : (
                        <Link
                          href={`/products/${p.slug}`}
                          className="hover:text-accent-600 hover:underline underline-offset-2"
                        >
                          {p.name}
                        </Link>
                      )}
                    </p>
                    <div className="flex flex-wrap items-baseline gap-x-2 mt-0.5">
                      <span className="font-semibold text-foreground">
                        {p.hasVariants ? 'From ' : ''}&#x20B9;{formatRupees(p.displayPrice)}
                      </span>
                      {p.mrp != null && p.mrp > p.displayPrice && (
                        <span className="text-xs text-foreground-muted line-through">
                          &#x20B9;{formatRupees(p.mrp)}
                        </span>
                      )}
                      {p.hasVariants ? (
                        isCurrent ? (
                          <button
                            type="button"
                            onClick={() => scrollToId(PDP_OPTIONS_ID, 'center')}
                            className="text-xs font-semibold text-accent-600 dark:text-accent-400 hover:underline"
                          >
                            Choose options above
                          </button>
                        ) : (
                          <Link
                            href={`/products/${p.slug}`}
                            className="text-xs font-semibold text-accent-600 dark:text-accent-400 hover:underline"
                          >
                            Choose options
                          </Link>
                        )
                      ) : Number(p.effectiveStock) <= 0 ? (
                        <span className="text-xs font-medium text-red-600 dark:text-red-400">Out of stock</span>
                      ) : !addable ? (
                        <span className="text-xs font-medium text-foreground-muted">Currently unavailable</span>
                      ) : null}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>

        {showBuyBox && (
          <div className="lg:w-64 shrink-0 rounded-lg border border-border-default bg-surface p-4">
            <p className="text-sm text-foreground-secondary">
              Total for {picked.length} {picked.length === 1 ? 'item' : 'items'}
            </p>
            <p className="text-2xl font-bold text-primary-600 dark:text-primary-400" aria-live="polite">
              &#x20B9;{formatRupees(total)}
            </p>
            {gstEnabled && <p className="text-[11px] text-foreground-muted">Inclusive of all taxes</p>}
            <button
              type="button"
              onClick={addSelected}
              disabled={adding || picked.length === 0}
              className="mt-3 w-full inline-flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {adding && (
                <span
                  className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"
                  aria-hidden="true"
                />
              )}
              {adding ? 'Adding...' : 'Add selected to cart'}
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
