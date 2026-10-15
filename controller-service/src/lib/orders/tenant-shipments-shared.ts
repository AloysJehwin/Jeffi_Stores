export interface ShipmentRow {
  id: string
  order_number: string | null
  awb_number: string | null
  payment_mode: string | null
  shipment_status: string | null
  shipping_amount: string | null
  delhivery_billed_amount: string | null
  delhivery_extra_charge: string | null
  delhivery_billed_at: string | null
}
