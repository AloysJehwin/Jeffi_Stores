'use client'

import { useIsMobile } from '@/contexts/PortalDeviceContext'
import { STAFF_NOTES } from '@/lib/portal-config'
import { useStaffNoteDraft } from './useStaffNoteDraft'
import StaffNotesFormMobile from './StaffNotesFormMobile'
import StaffNotesFormDesktop from './StaffNotesFormDesktop'

// Picks the dedicated device variant; both share one draft hook.
export default function StaffNotesEntry({ staff }: { staff: { email: string; name: string | null } }) {
  const isMobile = useIsMobile()
  const d = useStaffNoteDraft(STAFF_NOTES.auth.logout)
  return isMobile ? <StaffNotesFormMobile d={d} staff={staff} /> : <StaffNotesFormDesktop d={d} staff={staff} />
}
