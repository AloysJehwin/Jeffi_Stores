import { LoadingForm } from '@/components/admin/kit/skeleton'

/** CouponForm's sections (main beside aside) while the add / edit page loads. */
export default function CouponFormLoading({ footer = true }: { footer?: boolean }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <LoadingForm
            footer={false}
            sections={[
              { title: 'Code & Discount', fields: ['Coupon Code', 'Discount Type *', 'Discount Value', 'Max Discount (₹)'] },
              { title: 'Limits', fields: ['Min Purchase (₹)', 'Total Usage Limit', 'Per-User Limit'], cols: 3 },
              { title: 'Description', fields: ['Coupon Description'], cols: 1 },
            ]}
          />
        </div>
        <LoadingForm
          footer={false}
          sections={[
            { title: 'Status', fields: ['Active'], cols: 1 },
            { title: 'Validity', fields: ['Valid From', 'Valid Until'], cols: 1 },
          ]}
        />
      </div>
      {footer && <LoadingForm sections={[]} />}
    </div>
  )
}
