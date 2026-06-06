'use client'

export default function BusinessCartPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-foreground">Cart</h1>
      <div className="bg-surface-elevated border border-border-default rounded-xl p-8 text-center">
        <p className="text-foreground-muted">Your cart is empty.</p>
      </div>
    </div>
  )
}
