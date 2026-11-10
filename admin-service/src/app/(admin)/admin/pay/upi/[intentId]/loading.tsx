import { UpiCheckoutLoading } from '@/components/payments'

export default function Loading() {
  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div className="flex min-h-[60vh] items-center justify-center">
        <UpiCheckoutLoading />
      </div>
    </div>
  )
}
