import { supabaseAdmin } from './supabase'
import { DashboardStats } from '@/types'

export async function getDashboardStats(): Promise<DashboardStats> {
  try {
    // Get total products
    const { count: totalProducts } = await supabaseAdmin
      .from('products')
      .select('*', { count: 'exact', head: true })

    // Get total orders
    const { count: totalOrders } = await supabaseAdmin
      .from('orders')
      .select('*', { count: 'exact', head: true })

    // Get total revenue
    const { data: revenueData } = await supabaseAdmin
      .from('orders')
      .select('total_amount')
      .eq('payment_status', 'paid')

    const totalRevenue = revenueData?.reduce((sum, order) => sum + Number(order.total_amount), 0) || 0

    // Get total customers
    const { count: totalCustomers } = await supabaseAdmin
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true)

    // Get low stock products
    const { count: lowStockProducts } = await supabaseAdmin
      .from('products')
      .select('*', { count: 'exact', head: true })
      .filter('stock_quantity', 'lte', 'low_stock_threshold')

    // Get pending orders
    const { count: pendingOrders } = await supabaseAdmin
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending')

    return {
      totalProducts: totalProducts || 0,
      totalOrders: totalOrders || 0,
      totalRevenue: totalRevenue || 0,
      totalCustomers: totalCustomers || 0,
      lowStockProducts: lowStockProducts || 0,
      pendingOrders: pendingOrders || 0,
    }
  } catch (error) {
    console.error('Error fetching dashboard stats:', error)
    return {
      totalProducts: 0,
      totalOrders: 0,
      totalRevenue: 0,
      totalCustomers: 0,
      lowStockProducts: 0,
      pendingOrders: 0,
    }
  }
}

export async function getAllProducts() {
  const { data, error } = await supabaseAdmin
    .from('products')
    .select(`
      *,
      categories (id, name, slug),
      brands (id, name, slug),
      product_images (*)
    `)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export async function getProduct(id: string) {
  const { data, error } = await supabaseAdmin
    .from('products')
    .select(`
      *,
      categories (id, name, slug),
      brands (id, name, slug),
      product_images (*)
    `)
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

export async function getAllCategories() {
  const { data, error } = await supabaseAdmin
    .from('categories')
    .select('*')
    .order('display_order', { ascending: true })

  if (error) throw error
  return data
}

export async function getAllBrands() {
  const { data, error } = await supabaseAdmin
    .from('brands')
    .select('*')
    .eq('is_active', true)
    .order('name', { ascending: true })

  if (error) throw error
  return data
}

export async function getAllOrders() {
  const { data, error } = await supabaseAdmin
    .from('orders')
    .select(`
      *,
      users (id, email, first_name, last_name, phone)
    `)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export async function getRecentOrders(limit: number = 10) {
  const { data, error } = await supabaseAdmin
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return data
}

export async function getOrder(id: string) {
  const { data, error } = await supabaseAdmin
    .from('orders')
    .select(`
      *,
      users (id, email, first_name, last_name, phone),
      order_items (
        *,
        products (id, name, sku)
      )
    `)
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}
