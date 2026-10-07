'use client'

import { useStoreFlag } from './useStoreFlags'

export function useLoyaltyEnabled(): boolean {
  return useStoreFlag('loyaltyEnabled')
}
