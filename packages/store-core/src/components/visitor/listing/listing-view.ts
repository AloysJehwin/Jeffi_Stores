'use client'

import { createContext } from 'react'

/** ProductGrid's view mode, for controls rendered inside it: the table view sorts by its column titles. */
export const ListingViewContext = createContext<'grid' | 'table'>('grid')
