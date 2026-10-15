'use client'

import { installSessionGuard } from '@/lib/client/session-guard'

// Installed at module load, before any effect or data fetch runs, so every API call made by the
// app already carries its signed proof.
installSessionGuard()

export default function SessionGuard() {
  return null
}
