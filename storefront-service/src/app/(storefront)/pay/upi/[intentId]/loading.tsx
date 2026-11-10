import { UpiCheckoutLoading } from '@/components/payments'

export default function Loading() {
  return (
    <div className="min-h-[70vh] bg-surface px-4 py-10 flex items-center justify-center">
      <UpiCheckoutLoading />
    </div>
  )
}
