import AuthSplit from '@/app/(ecom)/ecom/AuthSplit'

export const dynamic = 'force-dynamic'

export default function EcomSignInPage() {
  return <AuthSplit mode="signin" />
}
