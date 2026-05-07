export interface Product {
  id: string
  category_id: string
  brand_id: string
  sku: string
  name: string
  slug: string
  description: string
  short_description: string
  base_price: number
  mrp?: number
  sale_price?: number
  wholesale_price?: number
  gst_percentage?: number
  currency: string
  hsn_code?: string
  mpn?: string
  gtin?: string
  stock_quantity: number
  low_stock_threshold: number
  is_in_stock: boolean
  weight?: number
  dimensions?: string
  material?: string
  finish?: string
  size?: string
  has_variants: boolean
  variant_type?: string
  is_featured: boolean
  is_active: boolean
  views_count: number
  sales_count: number
  weight_grams?: number
  package_type?: string
  length_cm?: number
  breadth_cm?: number
  height_cm?: number
  created_at: string
  updated_at: string
}

export interface ProductVariant {
  id: string
  product_id: string
  sku: string
  variant_name: string
  price: number | null
  mrp?: number | null
  sale_price?: number | null
  wholesale_price?: number | null
  stock_quantity: number
  mpn?: string
  gtin?: string
  attributes: Record<string, string> | null
  is_active: boolean
  weight_grams?: number
  package_type?: string
  length_cm?: number
  breadth_cm?: number
  height_cm?: number
  created_at: string
}

export interface ProductImage {
  id: string
  product_id: string
  image_url: string
  thumbnail_url: string
  s3_bucket: string
  s3_key: string
  s3_thumbnail_key: string
  file_name: string
  file_size?: number
  mime_type?: string
  width?: number
  height?: number
  alt_text?: string
  display_order: number
  is_primary: boolean
  created_at: string
  updated_at: string
}

export interface Category {
  id: string
  name: string
  slug: string
  description?: string
  image_url?: string
  parent_category_id?: string
  display_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Brand {
  id: string
  name: string
  slug: string
  logo_url?: string
  description?: string
  website?: string
  is_active: boolean
  created_at: string
}

export interface Order {
  id: string
  order_number: string
  user_id?: string
  customer_email: string
  customer_phone: string
  customer_name: string
  status: 'pending' | 'confirmed' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'refunded'
  payment_status: 'unpaid' | 'paid' | 'partial' | 'refunded'
  subtotal: number
  discount_amount: number
  tax_amount: number
  shipping_amount: number
  total_amount: number
  created_at: string
  updated_at: string
}

export interface User {
  id: string
  email: string
  phone?: string
  first_name?: string
  last_name?: string
  created_at: string
  updated_at: string
  is_active: boolean
}

export interface AdminSession {
  id: string
  user_id: string
  username: string
  role: string
  email: string
  first_name?: string
  last_name?: string
  exp: number
}

export interface DashboardStats {
  totalProducts: number
  totalOrders: number
  totalRevenue: number
  totalCustomers: number
  lowStockProducts: number
  pendingOrders: number
}
