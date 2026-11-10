import { View } from 'react-native'
import { Label, Radio, cn } from '../../ui'
import type { PayMethod } from './checkoutStore'

// Mirror of the web's components/payments/PaymentSections: a "UPI" section (the app's own UPI flow) above
// "Other payment methods" (Razorpay without UPI, COD, the business portal's manual payment). Without UPI
// it's the flat "Payment Method" list. The host keeps its pay button.

export function PaymentSections({
  value,
  onChange,
  upi,
  razorpay,
  cod,
  manual,
  compact,
  className,
}: {
  value: PayMethod
  onChange: (method: PayMethod) => void
  upi: boolean
  razorpay: boolean
  cod?: boolean
  manual?: boolean
  /** Plain rows instead of bordered cards (inside a notice). */
  compact?: boolean
  className?: string
}) {
  const card = !compact
  const others = (
    <>
      {razorpay && (
        <Radio
          card={card}
          selected={value === 'razorpay'}
          onSelect={() => onChange('razorpay')}
          label="Pay Online"
          description={upi ? 'Cards, Net Banking, Wallets' : 'UPI, Cards, Net Banking'}
        />
      )}
      {cod && <Radio card={card} selected={value === 'cod'} onSelect={() => onChange('cod')} label="Cash on Delivery" description="Pay when your order arrives" />}
      {manual && (
        <Radio
          card={card}
          selected={value === 'manual'}
          onSelect={() => onChange('manual')}
          label="Manual payment"
          description="Bank transfer or invoice — our team will contact you"
        />
      )}
    </>
  )
  if (!upi) {
    return (
      <View className={cn('gap-2', className)}>
        <Label>Payment Method</Label>
        {others}
      </View>
    )
  }
  return (
    <View className={cn('gap-4', className)}>
      <View className="gap-2">
        <Label>UPI</Label>
        <Radio card={card} selected={value === 'upi'} onSelect={() => onChange('upi')} label="Pay with UPI" description="PhonePe, GPay, Paytm, BHIM — any UPI app" />
      </View>
      {(razorpay || cod || manual) && (
        <View className="gap-2">
          <Label>Other payment methods</Label>
          {others}
        </View>
      )}
    </View>
  )
}
