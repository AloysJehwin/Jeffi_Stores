import ProfileCard from '../../src/components/account/ProfileCard'
import { useRequireAuth } from '../../src/components/account/hooks'
import { Screen } from '../../src/ui'

// The Profile section of controller-service app/(storefront)/account/page.tsx, opened for editing.

export default function ProfileScreen() {
  useRequireAuth()

  return (
    <Screen title="Profile" mode="keyboard">
      <ProfileCard initialEditing />
    </Screen>
  )
}
