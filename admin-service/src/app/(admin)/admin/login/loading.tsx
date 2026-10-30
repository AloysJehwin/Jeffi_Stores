import { AUTH_THEMES, AuthSplitSkeleton } from '@/components/auth/AuthSplitShell'

export default function Loading() {
  return <AuthSplitSkeleton theme={AUTH_THEMES.admin} />
}
