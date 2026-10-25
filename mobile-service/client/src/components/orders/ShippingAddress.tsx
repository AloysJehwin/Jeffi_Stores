import OrderAddressChange from '../account/OrderAddressChange'
import { BodySmall, Card, Heading, Text } from '../../ui'
import type { Order } from './shared'

/** Where the order ships (or bills, for digital orders), and the address-change request. */
export function ShippingAddress({ order, onChanged }: { order: Order; onChanged: () => void }) {
  const a = order.shippingAddress!
  return (
    <Card>
      <Heading className="mb-3">{order.isAllDigital ? 'Billing Address' : 'Shipping Address'}</Heading>
      <Text className="font-semibold text-foreground">{a.full_name}</Text>
      <BodySmall className="mt-1">{a.address_line1}</BodySmall>
      {!!a.address_line2 && <BodySmall>{a.address_line2}</BodySmall>}
      {!!a.landmark && <BodySmall>Landmark: {a.landmark}</BodySmall>}
      <BodySmall>
        {a.city}, {a.state} {a.postal_code}
      </BodySmall>
      <BodySmall className="mt-2">Phone: {a.phone}</BodySmall>
      <OrderAddressChange
        orderId={order.id}
        canChange={!!order.canChangeAddress && !order.isAllDigital}
        request={order.addressChange ?? null}
        currentAddress={a}
        onChanged={onChanged}
      />
    </Card>
  )
}
