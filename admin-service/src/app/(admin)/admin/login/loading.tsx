import { AUTH_POINTS, AUTH_THEMES } from '@/components/auth/AuthSplitShell'
import { Sk } from '@/components/admin/kit/skeleton'

// The admin sign-in screen with its real wording; the store's name, logo and headline shimmer.
const theme = AUTH_THEMES.admin
const GOOGLE = !!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID

const panelSk = (cls: string) => <span aria-hidden className={`sk block rounded-lg bg-white/20 ${cls}`} />

function Check({ cls }: { cls: string }) {
  return (
    <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${cls}`}>
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3" aria-hidden>
        <path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-8 8a1 1 0 01-1.4 0l-4-4a1 1 0 111.4-1.4L8 12.6l7.3-7.3a1 1 0 011.4 0z" clipRule="evenodd" />
      </svg>
    </span>
  )
}

export default function Loading() {
  return (
    <div className="relative grid min-h-[100dvh] grid-cols-1 bg-surface lg:grid-cols-2" role="status" aria-busy="true" aria-label="Loading Admin Panel">
      <aside className={`relative hidden flex-col justify-between overflow-hidden p-12 lg:flex ${theme.panel}`}>
        <div aria-hidden className="absolute -bottom-32 -right-32 h-[420px] w-[420px] rounded-full bg-white/10" />
        <div aria-hidden className="absolute -left-16 top-24 h-40 w-40 rounded-full bg-white/10" />
        <div className="relative flex items-center gap-3">
          {panelSk('h-9 w-9 rounded-full')}
          {panelSk('h-6 w-36')}
        </div>
        <div className="relative max-w-lg">
          <div className="space-y-3">
            {panelSk('h-11 w-11/12')}
            {panelSk('h-11 w-2/3')}
          </div>
          <p className="mt-4 text-base leading-relaxed opacity-80">The admin panel for orders, catalogue, customers and accounts.</p>
          <ul className="mt-8 space-y-3">
            {AUTH_POINTS.admin.map(p => (
              <li key={p} className="flex items-start gap-3 opacity-90">
                <Check cls={theme.check} />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm opacity-70">Authorized personnel only. All access is logged and monitored.</p>
      </aside>

      <main className="flex min-w-0 flex-col justify-center px-4 pb-10 pt-20 sm:px-12 sm:py-16">
        <div className="mb-8 flex items-center gap-2 self-center lg:hidden">
          <Sk className="h-9 w-9 rounded-full" />
          <Sk className="h-6 w-32" />
        </div>
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-foreground mb-1">Admin Panel</h1>
            <p className="text-sm text-foreground-muted">Sign in to access the dashboard</p>
          </div>
          <div className="mb-6 px-4 py-3 rounded-lg flex items-center gap-3 text-sm border bg-surface-secondary text-foreground-muted border-border-default">
            <div className="w-5 h-5 flex-shrink-0 border-2 border-foreground-muted border-t-transparent rounded-full animate-spin" />
            <span className="font-medium">Checking certificate...</span>
          </div>
          <div className="space-y-5">
            {GOOGLE && (
              <>
                <div className="control-md w-full gap-3 border border-border-default bg-surface-elevated font-medium text-foreground opacity-60">Continue with Google</div>
                <div className="flex items-center gap-3 text-foreground-muted text-sm">
                  <div className="flex-1 h-px bg-border-default" />
                  <span>or</span>
                  <div className="flex-1 h-px bg-border-default" />
                </div>
              </>
            )}
            <div className="space-y-6">
              <div>
                <p className="block text-sm font-medium text-foreground mb-1.5">Admin email</p>
                <Sk className="h-control rounded-lg" />
              </div>
              <div className="control-md w-full bg-accent-500 text-white font-semibold opacity-50">Send verification code</div>
            </div>
          </div>
        </div>
        <div className="mx-auto mt-10 w-full max-w-sm rounded-2xl border border-border-default bg-surface-elevated p-5 lg:hidden">
          <Sk className="h-5 w-3/4" />
          <ul className="mt-3 space-y-2.5">
            {AUTH_POINTS.admin.map(p => (
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
