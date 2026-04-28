import SupportChat from '@/components/visitor/SupportChat'
import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/jwt'

export const metadata = {
  title: 'Support | Jeffi Stores',
  description: 'Get help with your orders, payments, and more.',
}

async function getAuthUser() {
  try {
    const cookieStore = cookies()
    const token = cookieStore.get('auth_token')?.value
    if (!token) return null
    return await verifyToken(token)
  } catch {
    return null
  }
}

export default async function SupportPage() {
  const user = await getAuthUser()

  return (
    <div className="bg-surface min-h-screen">
      <div className="px-4 sm:px-6 xl:px-10 py-8 md:py-10">
        <div className="mb-8">
          <p className="text-accent-500 text-xs font-bold uppercase tracking-widest mb-1">Help & Support</p>
          <h1 className="text-3xl md:text-4xl font-extrabold text-foreground">How can we help?</h1>
          <p className="text-foreground-secondary mt-2">Chat with our support bot or get connected to a live agent.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-6 items-start">
          <div className="lg:col-span-1 space-y-5">
            <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
              <h2 className="font-bold text-foreground mb-4">Contact Us</h2>
              <div className="space-y-4 text-sm">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-accent-50 dark:bg-accent-900/30 flex items-center justify-center shrink-0">
                    <svg className="w-4 h-4 text-accent-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-foreground-muted text-xs mb-0.5">Phone</p>
                    <a href="tel:+918903031299" className="text-foreground hover:text-accent-500 block transition-colors font-medium">+91 89030 31299</a>
                    <a href="tel:+919488354099" className="text-foreground hover:text-accent-500 block transition-colors font-medium">+91 94883 54099</a>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-accent-50 dark:bg-accent-900/30 flex items-center justify-center shrink-0">
                    <svg className="w-4 h-4 text-accent-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-foreground-muted text-xs mb-0.5">Email</p>
                    <a href="mailto:jeffistoress@gmail.com" className="text-foreground hover:text-accent-500 transition-colors font-medium">jeffistoress@gmail.com</a>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-accent-50 dark:bg-accent-900/30 flex items-center justify-center shrink-0">
                    <svg className="w-4 h-4 text-accent-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-foreground-muted text-xs mb-0.5">Address</p>
                    <span className="text-foreground font-medium">Sanjay Gandhi Chowk, Station Road, Raipur, CG 490092</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
              <h2 className="font-bold text-foreground mb-3">Business Hours</h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-foreground-secondary">Mon – Fri</span>
                  <span className="text-foreground font-semibold">9:00 AM – 7:00 PM</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-foreground-secondary">Saturday</span>
                  <span className="text-foreground font-semibold">9:00 AM – 6:00 PM</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-foreground-secondary">Sunday</span>
                  <span className="text-red-500 font-semibold">Closed</span>
                </div>
              </div>
            </div>

            <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
              <h2 className="font-bold text-foreground mb-4">How support works</h2>
              <ol className="space-y-4">
                <li className="flex gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary-500 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">1</div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">Chat with the bot</p>
                    <p className="text-xs text-foreground-muted mt-0.5">Ask about your orders, payments, shipping, or cancellations. The bot pulls your real order data instantly.</p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary-500 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">2</div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">Request a live agent</p>
                    <p className="text-xs text-foreground-muted mt-0.5">If the bot can&apos;t resolve it, tap &ldquo;Connect to Support Agent&rdquo; &mdash; our team gets an email alert instantly.</p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary-500 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">3</div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">Live chat session</p>
                    <p className="text-xs text-foreground-muted mt-0.5">A support agent joins your chat in real time. You can end the session once your issue is resolved.</p>
                  </div>
                </li>
              </ol>
            </div>
          </div>

          <div className="lg:col-span-2">
            {user ? (
              <div className="rounded-xl border border-border-default overflow-hidden shadow-sm" style={{ height: '75vh', minHeight: '560px' }}>
                <SupportChat />
              </div>
            ) : (
              <div className="bg-surface-elevated rounded-xl border border-border-default p-12 text-center shadow-sm">
                <div className="w-16 h-16 bg-primary-100 dark:bg-primary-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                </div>
                <h2 className="text-lg font-bold text-foreground mb-2">Sign in to use Support Chat</h2>
                <p className="text-foreground-secondary text-sm mb-6">Log in to chat with our support bot and get help with your orders and account.</p>
                <a href="/login" className="inline-block bg-primary-500 hover:bg-primary-600 text-white px-8 py-2.5 rounded-lg font-semibold text-sm transition-colors">
                  Sign In
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
