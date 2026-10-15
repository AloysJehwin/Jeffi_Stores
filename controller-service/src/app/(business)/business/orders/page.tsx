'use client'

export default function BusinessOrdersPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-foreground">My Orders</h1>
      <div className="bg-surface-elevated border border-border-default rounded-xl p-8 text-center">
        <p className="text-foreground-muted">Your orders will appear here once you place one.</p>
      </div>
    </div>
  )
}
