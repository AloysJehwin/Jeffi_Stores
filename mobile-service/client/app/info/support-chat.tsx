import { useRouter } from 'expo-router'
import { MessageSquare } from 'lucide-react-native'
import { EmptyState, Screen, ScreenHeader, Spinner } from '../../src/ui'
import SupportChat from '../../src/components/info/SupportChat'
import { useAuthStore } from '../../src/stores/authStore'
import { openHref } from '../../src/lib/links'

// The support chat, full screen (web: the chat on /support).
export default function SupportChatScreen() {
  const router = useRouter()
  const { user, isLoading } = useAuthStore()
  if (user) return <SupportChat />
  return (
    <Screen header={<ScreenHeader title="Support chat" />} mode="none">
      {isLoading ? (
        <Spinner />
      ) : (
        <EmptyState
          fill
          icon={MessageSquare}
          title="Sign in to chat with us"
          message="Log in to chat with our assistant and get help with your orders and account."
          actionLabel="Sign In"
          onAction={() => openHref(router, '/login')}
        />
      )}
    </Screen>
  )
}
