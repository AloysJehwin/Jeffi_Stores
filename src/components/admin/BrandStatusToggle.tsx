'use client'

import { useState } from 'react'

interface Props {
  brandId: string
  brandData: {
    name: string
    slug: string
    description: string | null
    website: string | null
    is_active: boolean
    return_allowed: boolean
    return_window_days: number
    replacement_allowed: boolean
    replacement_window_days: number
  }
}

export default function BrandStatusToggle({ brandId, brandData }: Props) {
  const [isActive, setIsActive] = useState(brandData.is_active)
  const [toggling, setToggling] = useState(false)

  async function toggle(e: React.MouseEvent) {
    e.stopPropagation()
    if (toggling) return
    setToggling(true)
    const next = !isActive
    setIsActive(next)
    try {
      const res = await fetch(`/api/admin/brands/${brandId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: brandData.name,
          slug: brandData.slug,
          description: brandData.description,
          website: brandData.website,
          logo_url: null,
          is_active: next,
          return_allowed: brandData.return_allowed,
          return_window_days: brandData.return_window_days,
          replacement_allowed: brandData.replacement_allowed,
          replacement_window_days: brandData.replacement_window_days,
        }),
      })
      if (!res.ok) setIsActive(!next)
    } catch {
      setIsActive(!next)
    } finally {
      setToggling(false)
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={toggling}
      className={`flex-shrink-0 ml-2 px-2 py-0.5 text-xs font-semibold rounded-full transition-opacity ${toggling ? 'opacity-50' : 'hover:opacity-75'} ${
        isActive
          ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
          : 'bg-surface-secondary text-foreground'
      }`}
    >
      {isActive ? 'Active' : 'Inactive'}
    </button>
  )
}
