// The page itself is this spinner while it hands the payment back to checkout.
export default function Loading() {
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center" role="status" aria-busy="true">
      <div className="text-center space-y-3">
        <svg className="w-8 h-8 text-accent-500 animate-spin mx-auto" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
        </svg>
        <p className="text-sm text-foreground-secondary">Confirming your payment…</p>
      </div>
    </div>
  )
}
