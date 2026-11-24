import AuthSplit from '@controller/app/(ecom)/ecom/AuthSplit'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Sign up' }

export default async function EcomSignUpPage({ searchParams }: { searchParams: Promise<{ plan?: string; interval?: string; next?: string }> }) {
  const { plan, interval, next } = await searchParams
  return <AuthSplit mode="signup" plan={plan} interval={interval} next={next} />
}
