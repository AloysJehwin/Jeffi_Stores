'use client'

import { useStoreFlag } from './useStoreFlags'

export function useReferralEnabled(): boolean {
  return useStoreFlag('referralEnabled')
}
