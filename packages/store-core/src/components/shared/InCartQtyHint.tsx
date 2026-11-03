import { unitCapError, type PickerQtyCap } from '@/lib/catalog/cart-unit-cap'

function fmt(n: number) {
  return String(Number(n.toFixed(6)))
}

/** "5 already in cart" / "Max quantity already in cart" under an add-to-cart picker. */
export default function InCartQtyHint({
  cap,
  unitLabel,
  adding,
}: {
  cap: PickerQtyCap
  unitLabel?: string | null
  /** When set, explains why this quantity can't be added on top of the cart line. */
  adding?: number
}) {
  const over =
    adding != null && cap.max != null && !cap.full ? unitCapError(cap.max + cap.inCart, cap.inCart, adding) : null
  if (over) {
    return (
      <p role="status" className="text-xs font-medium text-amber-700 dark:text-amber-400">
        {over}
      </p>
    )
  }
  if (cap.full) {
    return (
      <p role="status" className="text-xs font-medium text-amber-700 dark:text-amber-400">
        Max quantity already in cart
      </p>
    )
  }
  if (cap.inCart <= 0) return null
  return (
    <p role="status" className="text-xs text-foreground-muted">
      {fmt(cap.inCart)}
      {unitLabel ? ` ${unitLabel}` : ''} already in cart
    </p>
  )
}
