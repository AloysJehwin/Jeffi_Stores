import { cookies, headers } from 'next/headers'
import { verifyToken } from '@/lib/auth/jwt'
import { queryMany } from '@/lib/shared/db'
import { Suspense } from 'react'
import PackingSlipsTabs from './_components/PackingSlipsTabs'
import { getStoreIdentity } from '@/lib/catalog/site-controls'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function generateMetadata() {
  const { name } = await getStoreIdentity()
  return { title: `Packing Slips — ${name} Admin` }
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
  return (
    <Suspense fallback={null}>
      <PackingSlipsTabs initialOrders={orders} />
    </Suspense>
  )
}
