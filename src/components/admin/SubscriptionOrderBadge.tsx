export default function SubscriptionOrderBadge({
  subscriptionId,
  cycle,
  className = '',
}: {
  subscriptionId?: string | null
  cycle?: number | null
  className?: string
}) {
  if (!subscriptionId) return null
  return (
    <span
      className={`inline-block px-1.5 py-0.5 text-xs font-medium rounded bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 whitespace-nowrap ${className}`}
    >
      Subscription{cycle ? ` · cycle ${cycle}` : ''}
    </span>
  )
}
