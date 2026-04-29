import { cookies, headers } from 'next/headers'
import { verifyToken } from '@/lib/jwt'
import { queryMany } from '@/lib/db'
import PackingSlipsClient from './PackingSlipsClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const metadata = {
  title: 'Packing Slips — Jeffi Admin',
}

async function getInitialOrders() {
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  const from = thirtyDaysAgo.toISOString().slice(0, 10)

  const orders = await queryMany(
    `SELECT o.id, o.order_number, o.customer_name, o.created_at, o.status, o.total_amount
     FROM orders o
     WHERE o.created_at >= $1::date
     ORDER BY o.created_at DESC
     LIMIT 500`,
    [from]
  )
  return orders || []
}

export default async function PackingSlipsPage() {
  const orders = await getInitialOrders()
  return <PackingSlipsClient initialOrders={orders} />
}
