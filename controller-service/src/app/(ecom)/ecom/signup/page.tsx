import AuthSplit from '@controller/app/(ecom)/ecom/AuthSplit'

export const dynamic = 'force-dynamic'

export default async function EcomSignUpPage({ searchParams }: { searchParams: Promise<{ plan?: string; interval?: string }> }) {
  const { plan, interval } = await searchParams
  return <AuthSplit mode="signup" plan={plan} interval={interval} />
}
