export interface ProductImage {
  id: string
  image_url: string
  thumbnail_url: string
  is_primary: boolean
  display_order: number
}

export interface ProductVariant {
  id: string
  variant_name: string
  sku: string
  price: number | null
  sale_price: number | null
  mrp: number | null
  stock_quantity: number
  is_active: boolean
}

export interface Category {
  id: string
  name: string
  slug: string
  parent_category_id: string | null
  image_url: string | null
  display_order?: number
}

export interface Brand {
  id: string
  name: string
  slug: string
}

export interface Product {
  id: string
  name: string
  slug: string
  sku: string
  description: string | null
  base_price: number
  sale_price: number | null
  mrp: number | null
  gst_percentage: number | null
  has_variants: boolean
  stock_quantity: number
  low_stock_threshold: number
  is_active: boolean
  is_featured: boolean
  categories: Category | null
  brands: Brand | null
  product_images: ProductImage[]
  product_variants: ProductVariant[]
  variant_min_price?: number | null
  variant_stock_total?: number
  weight_rate?: number | null
  weight_unit?: string | null
  length_rate?: number | null
  length_unit?: string | null
}

export interface CartItem {
  id: string
  product_id: string
  variant_id: string | null
  quantity: number
  buy_mode: 'unit' | 'weight' | 'length'
  buy_unit: string | null
  price_at_addition: number | null
  products: Product
  variant: ProductVariant | null
}

export interface Address {
  id: string
  full_name: string
  phone: string
  address_line1: string
  address_line2: string | null
  landmark: string | null
  city: string
  state: string
  postal_code: string
  country: string
  address_type: 'shipping' | 'billing' | 'both'
  is_default: boolean
}

export interface OrderItem {
  id: string
  productId: string
  productName: string
  variantName: string | null
  quantity: number
  unitPrice: number
  totalPrice: number
  buyMode: string
  buyUnit: string | null
  products: {
    slug: string
    product_images: ProductImage[]
  } | null
}

export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'processing'
  | 'shipped'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancel_requested'
  | 'cancel_rejected'
  | 'cancelled'
  | 'return_requested'
  | 'return_approved'
  | 'return_received'
  | 'return_rejected'
  | 'returned'

export type PaymentStatus = 'pending' | 'unpaid' | 'paid' | 'failed' | 'refunded'

export interface ReturnRequest {
  id: string
  type: 'refund' | 'replacement'
  reason: string
  description: string | null
  status: 'requested' | 'approved' | 'rejected' | 'received' | 'completed'
  admin_notes: string | null
  replacement_order_id: string | null
  created_at: string
}

export interface Order {
  id: string
  orderNumber: string
  invoiceNumber: string | null
  status: OrderStatus
  paymentStatus: PaymentStatus
  payment_method?: 'razorpay' | 'manual'
  subtotal: number
  taxAmount: number
  totalAmount: number
  notes: string | null
  createdAt: string
  updatedAt: string
  deliveredAt: string | null
  trackingUrl: string | null
  originalOrderId: string | null
  originalOrderNumber: string | null
  cancellation_note?: string | null
  shippingAddress: {
    full_name: string
    address_line1: string
    address_line2: string | null
    landmark: string | null
    city: string
    state: string
    postal_code: string
    phone: string
  } | null
  items: OrderItem[]
}

export interface User {
  id: string
  email: string
  firstName: string
  lastName: string
  phone: string | null
  createdAt?: string
}

export interface Review {
  id: string
  rating: number
  title: string | null
  review_text: string | null
  created_at: string
  user_name: string
}

export interface WishlistItem {
  id: string
  product_id: string
  products: Product
}
