'use client'

import { useRouter, useSearchParams } from 'next/navigation'

export default function SortDropdown() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const handleSortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const params = new URLSearchParams(searchParams.toString())
    const value = e.target.value

    if (value.includes('&order=')) {
      const [sort, order] = value.split('&order=')
      params.set('sort', sort)
      params.set('order', order)
    } else {
      params.set('sort', value)
      params.delete('order')
    }

    router.push(`/products?${params.toString()}`)
  }

  const currentSort = searchParams.get('sort') || 'created_at'
  const currentOrder = searchParams.get('order') || 'desc'
  const currentValue = currentOrder === 'desc' && currentSort === 'base_price'
    ? `${currentSort}&order=${currentOrder}`
    : currentSort

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="sort" className="text-sm text-gray-600">Sort by:</label>
      <select
        id="sort"
        className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-accent-500 focus:border-transparent"
        onChange={handleSortChange}
        value={currentValue}
      >
        <option value="created_at">Newest First</option>
        <option value="name">Name (A-Z)</option>
        <option value="base_price">Price: Low to High</option>
        <option value="base_price&order=desc">Price: High to Low</option>
      </select>
    </div>
  )
}
