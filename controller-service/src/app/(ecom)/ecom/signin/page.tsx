import AuthSplit from '@controller/app/(ecom)/ecom/AuthSplit'

export const dynamic = 'force-dynamic'

export default async function EcomSignInPage({ searchParams }: { searchParams: Promise<{ plan?: string; interval?: string }> }) {
  const { plan, interval } = await searchParams
  return <AuthSplit mode="signin" plan={plan} interval={interval} />
}
