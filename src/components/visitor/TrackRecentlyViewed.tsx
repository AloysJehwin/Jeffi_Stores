'use client'

import { useEffect } from 'react'
import { trackRecentlyViewed } from './RecentlyViewed'

interface Props {
  id: string
  name: string
  slug: string
  price: number
  image: string | null
}

export default function TrackRecentlyViewed({ id, name, slug, price, image }: Props) {
  useEffect(() => {
    trackRecentlyViewed({ id, name, slug, price, image })
  }, [id, name, slug, price, image])

  return null
}
