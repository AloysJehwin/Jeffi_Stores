import { renderUtilityPage } from '@/components/visitor/site/code/parts/utility/site-page'
import AuthSplit from '@/components/visitor/site/AuthSplit'
import SignupClient from './SignupClient'

// Sign up. An AI-designed sign-up page places the form itself (<SignUpForm />); a Site Builder sign-up page holds it in
// its `signup_main` block (optionally beside a picture) with the store's own blocks around it; otherwise it is the page.
export default async function SignupPage({ searchParams }: { searchParams: Promise<{ preview?: string; layout?: string }> }) {
  const site = await renderUtilityPage({ audience: 'store', page: 'signup' }, await searchParams, {
    part: 'SignUpForm',
    core: <SignupClient embedded bare />,
    block: { signup_main: props => <AuthSplit props={props} form={embedded => <SignupClient embedded={embedded} />} /> },
  })
  return site ?? <SignupClient />
}
