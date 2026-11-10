import { Sk } from '@/components/admin/kit/skeleton'
import { CheckMark } from './Shapes'

const POINTS = [
  'Your own branded storefront + admin',
  'Online & COD payments, settled for you',
  'Delhivery delivery + GST invoicing built in',
  'Live in minutes — no servers, no code',
]

/** AuthSplit while it checks the session: the brand panel and the form's own heading. */
export default function AuthSplitLoading({ mode }: { mode: 'signup' | 'signin' }) {
  return (
    <div className="min-h-screen grid lg:grid-cols-2" aria-busy="true" aria-label="Loading">
      <div className="ecom-accent-bg relative hidden lg:flex flex-col justify-between overflow-hidden text-white p-12">
        <div aria-hidden className="org-sage absolute -bottom-32 -right-32 w-[420px] h-[420px] rounded-full opacity-60" />
        <div aria-hidden className="org-peach absolute top-24 -left-16 w-40 h-40 rounded-full opacity-50" />
        <span className="relative flex items-center gap-2 font-display font-black text-xl">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-white/20 text-white">J</span>
          Jeffi Commerce
        </span>
        <div className="relative">
          <h2 className="font-display font-black text-4xl xl:text-5xl leading-[1.05]">Everything you need to sell online — in one place.</h2>
          <ul className="mt-8 space-y-3">
            {POINTS.map(p => (
              <li key={p} className="flex items-center gap-3 text-white/90">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-white/20">
                  <CheckMark className="w-3 h-3 text-white" />
                </span>
                {p}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-white/70">Trusted plumbing for payments, delivery and compliance — so you just sell.</p>
      </div>
      <div className="flex flex-col justify-center px-4 py-10 sm:px-12 sm:py-12 bg-surface">
        <div className="w-full max-w-sm mx-auto">
          <h1 className="font-display font-black text-3xl sm:text-4xl text-foreground text-center sm:text-left">
            {mode === 'signup' ? 'Create your store account' : 'Welcome back'}
          </h1>
          <p className="text-sm text-foreground-muted mt-2 text-center sm:text-left">
            {mode === 'signup' ? 'Start selling on your own Jeffi-powered store.' : 'Sign in to your store dashboard.'}
          </p>
          <div className="mt-6 space-y-4">
            {mode === 'signup' && <Sk className="h-12 w-full rounded-xl" />}
            <Sk className="h-12 w-full rounded-xl" />
            <Sk className="h-12 w-full rounded-full" />
            <Sk className="h-12 w-full rounded-full" />
          </div>
        </div>
      </div>
    </div>
  )
}
