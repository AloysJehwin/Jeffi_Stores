import { renderUtilityPage } from '@/components/visitor/site/code/parts/utility/site-page'
import AuthSplit from '@/components/visitor/site/AuthSplit'
import LoginClient from './LoginClient'

// Sign in. An AI-designed sign-in page places the form itself (<SignInForm />); a Site Builder sign-in page holds it in
// its `login_main` block (optionally beside a picture) with the store's own blocks around it; otherwise it is the page.
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ preview?: string; layout?: string }> }) {
  const site = await renderUtilityPage({ audience: 'store', page: 'login' }, await searchParams, {
    part: 'SignInForm',
    core: <LoginClient embedded bare />,
    block: { login_main: props => <AuthSplit props={props} form={embedded => <LoginClient embedded={embedded} />} /> },
  })
  return site ?? <LoginClient />
}
