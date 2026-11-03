'use client'

import dynamic from 'next/dynamic'

const CompareStrip = dynamic(() => import('./CompareStrip'), { ssr: false })

export default function CompareStripLazy() {
  return <CompareStrip />
}
