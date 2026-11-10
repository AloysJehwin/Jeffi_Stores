import { Sk } from '@/components/admin/kit/skeleton'

const CARD = 'bg-surface-elevated rounded-lg shadow-md p-4 sm:p-6'

export default function ConfirmationSkeleton() {
  return (
    <div className="bg-surface min-h-screen py-12" role="status" aria-busy="true" aria-label="Loading order">
      <div className="container mx-auto px-4">
        <div className="bg-green-50 dark:bg-green-900/30 border-2 border-green-200 dark:border-green-800 rounded-lg p-4 sm:p-6 lg:p-8 mb-8 text-center">
          <div className="flex justify-center mb-4">
            <svg className="w-16 h-16 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <path d="M8.5 12.5l2.5 2.5 5-5" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-foreground mb-2">Order Confirmed!</h1>
          <p className="text-foreground-secondary mb-4">
            Thank you for your purchase. Your order has been successfully placed.
          </p>
          <div className="bg-surface-elevated rounded-lg p-4 inline-block">
            <p className="text-sm text-foreground-secondary mb-1">Order Number</p>
            <Sk className="h-8 w-40" />
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3 lg:items-start">
          <div className="lg:col-span-2">
            <div className={`${CARD}`}>
              <h2 className="text-xl font-bold text-foreground mb-4">Order Summary</h2>
              <div className="space-y-4 mb-6">
                {[0, 1].map(i => (
                  <div key={i} className="flex justify-between items-center gap-4 pb-4 border-b border-border-default last:border-b-0">
                    <div className="flex-1 space-y-1.5">
                      <Sk className="h-5 w-3/5" />
                      <Sk className="h-4 w-24" />
                      <Sk className="h-4 w-32" />
                    </div>
                    <Sk className="h-5 w-20" />
                  </div>
                ))}
              </div>
              <div className="border-t-2 border-border-default pt-4">
                <div className="flex justify-between items-center">
                  <span className="text-lg font-bold text-foreground">Total</span>
                  <Sk className="h-8 w-28" />
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className={`${CARD}`}>
              <h2 className="text-xl font-bold text-foreground mb-4">Shipping Address</h2>
              <div className="space-y-2">
                <Sk className="h-4 w-3/5" />
                <Sk className="h-4 w-1/2" />
                <Sk className="h-4 w-36 mt-3" />
              </div>
            </div>

            <div className={`${CARD}`}>
              <h2 className="text-xl font-bold text-foreground mb-4">Order Status</h2>
              <div className="flex flex-wrap items-center gap-3">
                <Sk className="h-10 w-28 rounded-full" />
                <span className="flex items-center gap-1 text-foreground-secondary">
                  Placed on <Sk className="inline-block h-4 w-40" />
                </span>
              </div>
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <p className="text-blue-900 dark:text-blue-300 text-sm">
                A confirmation email has been sent to your email address with your order details.
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <span className="bg-accent-600 text-white px-6 py-3 rounded-lg text-center font-semibold">View All Orders</span>
              <span className="bg-surface-elevated text-foreground-secondary px-6 py-3 rounded-lg border-2 border-border-secondary text-center font-semibold">
                Continue Shopping
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
