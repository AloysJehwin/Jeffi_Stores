import { demoTotal, type DemoLine } from './demo'

// Markup the cart and checkout parts share for the studio preview's sample lines.

export const money = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function DemoTotals({ lines, delivery = false }: { lines: DemoLine[]; delivery?: boolean }) {
  const total = demoTotal(lines)
  const count = lines.reduce((s, l) => s + l.qty, 0)
  return (
    <div className="space-y-3">
      <div className="flex justify-between text-foreground-secondary">
        <span>Subtotal ({count} items)</span>
        <span>{money(total)}</span>
      </div>
      {delivery && (
        <div className="flex justify-between text-foreground-secondary text-sm">
          <span>Delivery</span>
          <span>Free</span>
        </div>
      )}
      <div className="border-t border-border-default pt-3 flex justify-between text-lg font-bold text-foreground">
        <span>Total</span>
        <span>{money(total)}</span>
      </div>
      <p className="text-xs text-foreground-muted">Price inclusive of all taxes</p>
    </div>
  )
}
