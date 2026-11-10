import { Sk } from '@/components/admin/kit/skeleton'
import { AUTH_POINTS, AUTH_THEMES } from '@/components/auth/AuthSplitShell'

// Sign-in / sign-up loading screens. The store name and the OTP channels (store settings) shimmer;
// the Google button shows only when the page shows it.

const INPUT = 'w-full px-4 py-3 border border-border-secondary rounded-lg bg-surface text-foreground-muted'
const google = !!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID

function Label({ children }: { children: string }) {
  return <p className="block text-sm font-medium text-foreground-secondary mb-2">{children}</p>
}

function Divider({ text, bg = 'bg-surface-elevated', mb = 'mb-6' }: { text: string; bg?: string; mb?: string }) {
  return (
    <div className={`relative ${mb}`}>
      <div className="absolute inset-0 flex items-center">
        <div className="w-full border-t border-border-default" />
      </div>
      <div className="relative flex justify-center text-xs">
        <span className={`px-3 ${bg} text-foreground-muted`}>{text}</span>
      </div>
    </div>
  )
}

function GoogleButton({ label, mb = 'mb-4' }: { label: string; mb?: string }) {
  return (
    <div className={`w-full flex items-center justify-center gap-3 px-4 py-3 rounded-lg border border-border-secondary bg-surface text-sm font-medium text-foreground ${mb}`}>
      <span className="w-5 h-5 rounded-full border-2 border-border-strong" />
      {label}
    </div>
  )
}

function Channels() {
  return (
    <div className="flex gap-2">
      <Sk className="flex-1 h-11 rounded-lg" />
      <Sk className="flex-1 h-11 rounded-lg" />
    </div>
  )
}

function Submit({ children }: { children: string }) {
  return <div className="w-full bg-accent-500 text-white px-6 py-3 rounded-lg font-semibold text-center">{children}</div>
}

/** /login and /signup on the store: the centred card. */
export function StoreAuthSkeleton({ kind }: { kind: 'login' | 'signup' }) {
  const login = kind === 'login'
  return (
    <div
      className="min-h-screen bg-surface flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8"
      role="status"
      aria-busy="true"
      aria-label={login ? 'Loading login' : 'Loading sign up'}
    >
      <div className="max-w-md w-full">
        <div className="bg-surface-elevated rounded-lg shadow-lg p-4 sm:p-6 lg:p-8">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold text-foreground">{login ? 'Welcome Back' : 'Create Account'}</h2>
            <p className="mt-2 text-sm text-foreground-secondary flex items-center justify-center gap-1">
              {login ? 'Login to your' : 'Join'} <Sk className="inline-block h-4 w-20" />{' '}
              {login ? 'account' : 'for exclusive deals'}
            </p>
          </div>
          {google && (
            <>
              <GoogleButton label={login ? 'Continue with Google' : 'Sign up with Google'} />
              <Divider text={login ? 'or continue with email or mobile' : 'or sign up with email'} />
            </>
          )}
          {login ? (
            <div className="space-y-5">
              <div>
                <Label>Email or Mobile Number</Label>
                <div className={INPUT}>your@email.com or 10-digit number</div>
              </div>
              <div>
                <Label>Send OTP via</Label>
                <Channels />
              </div>
              <Submit>Continue</Submit>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>First Name *</Label>
                  <div className={INPUT}>John</div>
                </div>
                <div>
                  <Label>Last Name</Label>
                  <div className={INPUT}>Doe</div>
                </div>
              </div>
              <div>
                <Label>Email Address *</Label>
                <div className={INPUT}>your@email.com</div>
              </div>
              <div>
                <Label>Mobile Number *</Label>
                <div className="flex">
                  <span className="inline-flex items-center px-4 py-3 border border-r-0 border-border-secondary rounded-l-lg bg-surface-secondary text-foreground-secondary text-sm font-medium">
                    +91
                  </span>
                  <div className={`${INPUT} rounded-l-none`}>00000 00000</div>
                </div>
              </div>
              <div>
                <Label>Date of Birth *</Label>
                <div className={INPUT}>dd/mm/yyyy</div>
              </div>
              <div>
                <Label>How would you like to receive your OTP?</Label>
                <Channels />
              </div>
              <Submit>Send Verification Code</Submit>
            </div>
          )}
          <div className="mt-6 text-center text-sm text-foreground-secondary">
            {login ? "Don't have an account? " : 'Already have an account? '}
            <span className="text-accent-600 dark:text-accent-400 font-medium">{login ? 'Create one' : 'Login here'}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

const BUSINESS_AUTH = {
  signin: {
    headline: 'Your exclusive B2B partner portal',
    sub: 'Access custom pricing, request quotes on bulk orders, and manage your business purchases, all in one place.',
    footnote: 'Business accounts are reviewed before trade pricing is unlocked.',
    corner: ['New business partner?', 'Sign up'],
    title: 'Business Sign In',
    google: 'Continue with Google',
    submit: 'Continue',
    footer: ['New business partner? ', 'Apply for access'],
  },
  signup: {
    headline: 'Become a business partner',
    sub: "Apply once for trade pricing, bulk quotes and GST invoicing in your company's name.",
    footnote: 'Applications are reviewed within 24–48 hours.',
    corner: ['Already have an account?', 'Sign in'],
    title: 'Business Sign Up',
    google: 'Continue with Google',
    submit: 'Send Verification Code',
    footer: ['Already have an account? ', 'Sign in'],
  },
}

function Check({ cls }: { cls: string }) {
  return (
    <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${cls}`}>
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3" aria-hidden>
        <path
          fillRule="evenodd"
          d="M16.7 5.3a1 1 0 010 1.4l-8 8a1 1 0 01-1.4 0l-4-4a1 1 0 111.4-1.4L8 12.6l7.3-7.3a1 1 0 011.4 0z"
          clipRule="evenodd"
        />
      </svg>
    </span>
  )
}

/** /business/signin and /business/signup: AuthSplitShell's split with its real copy; the brand shimmers. */
export function BusinessAuthSkeleton({ kind }: { kind: 'signin' | 'signup' }) {
  const c = BUSINESS_AUTH[kind]
  const theme = AUTH_THEMES.business
  const points = AUTH_POINTS.business
  return (
    <div className="relative grid min-h-[100dvh] grid-cols-1 bg-surface lg:grid-cols-2" role="status" aria-busy="true" aria-label={`Loading ${c.title}`}>
      <div className="absolute right-4 top-4 z-10 flex items-center gap-3 sm:right-6 sm:top-6">
        <span className="hidden sm:inline-flex items-center text-sm text-foreground-secondary bg-surface/90 px-3 py-2 rounded-lg border border-border-default">
          {c.corner[0]}
        </span>
        <span className="inline-flex items-center px-4 py-2 rounded-lg bg-accent-500 text-white text-sm font-semibold shadow-sm">
          {c.corner[1]}
        </span>
      </div>
      <aside className={`relative hidden flex-col justify-between overflow-hidden p-12 lg:flex ${theme.panel}`}>
        <div aria-hidden className="absolute -bottom-32 -right-32 h-[420px] w-[420px] rounded-full bg-white/10" />
        <div aria-hidden className="absolute -left-16 top-24 h-40 w-40 rounded-full bg-white/10" />
        <div className="relative flex items-center gap-3">
          <span aria-hidden className="sk block h-9 w-9 rounded-full bg-white/15" />
          <span aria-hidden className="sk block h-6 w-36 rounded bg-white/15" />
        </div>
        <div className="relative max-w-lg">
          <h2 className="text-4xl font-black leading-[1.1] xl:text-5xl">{c.headline}</h2>
          <p className="mt-4 text-base leading-relaxed opacity-80">{c.sub}</p>
          <ul className="mt-8 space-y-3">
            {points.map(p => (
              <li key={p} className="flex items-start gap-3 opacity-90">
                <Check cls={theme.check} />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm opacity-70">{c.footnote}</p>
      </aside>
      <main className="flex min-w-0 flex-col justify-center px-4 pb-10 pt-20 sm:px-12 sm:py-16">
        <div className="mb-8 flex items-center gap-2 self-center lg:hidden">
          <Sk className="h-9 w-9 rounded-full" />
          <Sk className="h-6 w-32" />
        </div>
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8">
            <p className="text-sm text-foreground-muted mb-6">← Back to store</p>
            <h1 className="text-3xl font-bold text-foreground">{c.title}</h1>
            {kind === 'signin' ? (
              <p className="text-sm text-foreground-secondary mt-2 flex flex-wrap items-center gap-1">
                Access your <Sk className="inline-block h-4 w-20" /> business partner account
              </p>
            ) : (
              <p className="text-sm text-foreground-secondary mt-2">Create a business partner account to access exclusive pricing.</p>
            )}
          </div>
          {google && (
            <>
              <GoogleButton label={c.google} mb="mb-5" />
              <Divider text="or continue with email" bg="bg-surface" mb="mb-5" />
            </>
          )}
          <div className="space-y-5">
            <div>
              <p className="block text-sm font-medium text-foreground-secondary mb-1.5">Business Email</p>
              <div className={INPUT}>you@company.com</div>
            </div>
            {kind === 'signin' && (
              <div>
                <p className="text-sm font-medium text-foreground-secondary mb-1.5">Send OTP via</p>
                <Channels />
              </div>
            )}
            <Submit>{c.submit}</Submit>
          </div>
          <p className="mt-6 text-sm text-center text-foreground-secondary">
            {c.footer[0]}
            <span className="text-accent-600 dark:text-accent-400 font-medium">{c.footer[1]}</span>
          </p>
        </div>
        <div className="mx-auto mt-10 w-full max-w-sm rounded-2xl border border-border-default bg-surface-elevated p-5 lg:hidden">
          <p className="text-base font-bold leading-snug text-foreground">{c.headline}</p>
          <ul className="mt-3 space-y-2.5">
            {points.map(p => (
              <li key={p} className="flex items-start gap-3 text-sm text-foreground-secondary">
                <Check cls={theme.accent} />
                <span className="min-w-0">{p}</span>
              </li>
            ))}
          </ul>
        </div>
      </main>
    </div>
  )
}
