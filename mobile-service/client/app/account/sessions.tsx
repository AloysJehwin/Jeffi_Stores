import { useEffect } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Laptop, Smartphone } from 'lucide-react-native'
import { listBusinessSessions, revokeAllBusinessSessions, revokeBusinessSession, type BusinessSession } from '../../src/api/business'
import { useBusiness, useSignOut } from '../../src/components/account/hooks'
import { useAuthStore } from '../../src/stores/authStore'
import { Badge, BodySmall, Button, Card, EmptyState, ListGroup, ListRow, ListSkeleton, Screen, TextButton, confirm, toast } from '../../src/ui'

// The business portal's signed-in devices: each active session, revoke one or all.

function deviceLabel(s: BusinessSession): { name: string; mobile: boolean } {
  const ua = s.user_agent || ''
  const platform = (s.ua_platform || '').replace(/"/g, '')
  const os = /android/i.test(ua) || platform === 'Android' ? 'Android'
    : /iphone|ipad|ios/i.test(ua) || platform === 'iOS' ? 'iOS'
    : /windows/i.test(ua) || platform === 'Windows' ? 'Windows'
    : /mac os|macintosh/i.test(ua) || platform === 'macOS' ? 'Mac'
    : /linux/i.test(ua) ? 'Linux'
    : platform || 'Unknown device'
  const app = /jeffistoresapp|okhttp|expo|cfnetwork|dalvik/i.test(ua) && !/mozilla/i.test(ua)
  const browser = /edg\//i.test(ua) ? 'Edge' : /chrome\//i.test(ua) ? 'Chrome' : /firefox\//i.test(ua) ? 'Firefox' : /safari\//i.test(ua) ? 'Safari' : null
  const name = app ? `App on ${os}` : browser ? `${browser} on ${os}` : os
  return { name, mobile: os === 'Android' || os === 'iOS' }
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })

export default function SessionsScreen() {
  const router = useRouter()
  const qc = useQueryClient()
  const signOut = useSignOut()
  const isLoading = useAuthStore(s => s.isLoading)
  const { isBusiness } = useBusiness()

  useEffect(() => {
    if (!isLoading && !isBusiness) router.replace('/(tabs)/account')
  }, [isLoading, isBusiness, router])

  const q = useQuery({ queryKey: ['business-sessions'], queryFn: listBusinessSessions, enabled: isBusiness })
  const sessions = q.data ?? []

  const revoke = async (s: BusinessSession) => {
    const ok = await confirm({
      title: s.current ? 'Sign out of this device?' : 'Sign out this device?',
      message: s.current ? 'You’ll need to sign in again here.' : 'That device will need to sign in again.',
      confirmLabel: 'Sign out',
      destructive: true,
    })
    if (!ok) return
    try {
      await revokeBusinessSession(s.id)
      if (s.current) return signOut()
      toast.success('Device signed out')
      qc.invalidateQueries({ queryKey: ['business-sessions'] })
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : 'Could not sign out that device')
    }
  }

  const revokeAll = async () => {
    const ok = await confirm({
      title: 'Sign out everywhere?',
      message: 'Every device, including this one, will need to sign in again.',
      confirmLabel: 'Sign out everywhere',
      destructive: true,
    })
    if (!ok) return
    try {
      await revokeAllBusinessSessions()
      await signOut()
      router.replace('/(tabs)/account')
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : 'Could not sign out')
    }
  }

  return (
    <Screen
      title="Signed-in devices"
      loading={isLoading || q.isLoading}
      skeleton={<ListSkeleton />}
      error={q.error}
      onRetry={() => q.refetch()}
      refreshing={q.isRefetching}
      onRefresh={() => q.refetch()}
    >
      <BodySmall className="mb-4">Where your business account is signed in. Sign out any device you don’t recognise.</BodySmall>
      {sessions.length === 0 ? (
        <Card padded={false}>
          <EmptyState icon={Smartphone} title="No active sessions" />
        </Card>
      ) : (
        <ListGroup>
          {sessions.map(s => {
            const d = deviceLabel(s)
            return (
              <ListRow
                key={s.id}
                title={d.name}
                subtitle={`Last active ${when(s.last_seen_at)}${s.ip_address ? ` · ${s.ip_address}` : ''}\nSigned in ${when(s.created_at)}`}
                icon={d.mobile ? Smartphone : Laptop}
                chevron={false}
                trailing={
                  <View className="items-end gap-1">
                    {s.current ? <Badge label="This device" tone="success" size="sm" /> : null}
                    <TextButton label="Sign out" tone="danger" onPress={() => revoke(s)} />
                  </View>
                }
              />
            )
          })}
        </ListGroup>
      )}
      {sessions.length > 0 && <Button label="Sign out everywhere" variant="outline" className="mt-6" onPress={revokeAll} />}
    </Screen>
  )
}
