'use client'

import { useState } from 'react'
import { FileText } from 'lucide-react'
import IconButton from '@/components/ui/IconButton'
import BrochureModal from './BrochureModal'

/**
 * Tab-line action for the admin categories/brands pages. Opens the shared
 * BrochureModal in the matching mode so section 1 shows categories (category
 * page) or brands (brand page).
 */
export default function BrochureButton({ mode }: { mode: 'category' | 'brand' }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <IconButton icon={FileText} label="Generate Brochure" onClick={() => setOpen(true)} />
      <BrochureModal open={open} mode={mode} onClose={() => setOpen(false)} />
    </>
  )
}
