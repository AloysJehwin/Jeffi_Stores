import SupportChat from '@/components/visitor/SupportChat'
import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/jwt'

export const metadata = {
  title: 'Support | Jeffi Stores',
  description: 'Get help with your orders, payments, and more.',
}

async function getAuthUser() {
  try {
    const cookieStore = await cookies()
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
      <div className="container mx-auto px-4 py-8 md:py-12">

        {/* Header */}
        <div className="mb-6 md:mb-8">
          <p className="text-accent-500 text-xs font-bold uppercase tracking-widest mb-1">Help &amp; Support</p>
          <h1 className="text-3xl md:text-4xl font-extrabold text-foreground">How can we help?</h1>
          <p className="text-foreground-secondary mt-1.5 text-sm">Chat with our support bot or reach us directly.</p>
        </div>

        {/* Info strip — 3 columns */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8 md:mb-10">

          {/* Contact */}
          <div className="bg-surface-elevated rounded-xl border border-border-default p-5 space-y-4">
            <h2 className="font-bold text-foreground text-sm">Contact Us</h2>

            <div>
              <p className="text-xs text-foreground-muted mb-1">Phone</p>
              <a href="tel:+918903031299" className="text-sm font-medium text-foreground hover:text-accent-500 block transition-colors">+91 89030 31299</a>
              <a href="tel:+919488354099" className="text-sm font-medium text-foreground hover:text-accent-500 block transition-colors">+91 94883 54099</a>
            </div>

            <div>
              <p className="text-xs text-foreground-muted mb-1">Email</p>
              <a href="mailto:jeffistoress@gmail.com" className="text-sm font-medium text-foreground hover:text-accent-500 transition-colors break-all">jeffistoress@gmail.com</a>
            </div>

            <div>
              <p className="text-xs text-foreground-muted mb-1">Address</p>
              <p className="text-sm font-medium text-foreground leading-snug">Sanjay Gandhi Chowk, Station Road, Raipur, CG 490092</p>
            </div>

            <div className="pt-1 border-t border-border-default">
              <p className="text-xs text-foreground-muted mb-1.5">Business Hours</p>
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-foreground-secondary">Mon – Fri</span>
                  <span className="text-foreground font-medium">9 AM – 7 PM</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-foreground-secondary">Saturday</span>
                  <span className="text-foreground font-medium">9 AM – 6 PM</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-foreground-secondary">Sunday</span>
                  <span className="text-red-500 font-medium">Closed</span>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Links */}
          <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
            <h2 className="font-bold text-foreground text-sm mb-3">Quick Links</h2>
            <div className="divide-y divide-border-default">
              {[
                { label: 'My Orders', href: '/orders' },
                { label: 'My Account', href: '/account' },
                { label: 'Wishlist', href: '/wishlist' },
                { label: 'Browse Products', href: '/products' },
                { label: 'All Categories', href: '/categories' },
                { label: 'About Us', href: '/about' },
              ].map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="flex items-center justify-between py-2 text-sm text-foreground-secondary hover:text-accent-500 transition-colors group"
                >
                  {link.label}
                  <svg className="w-3.5 h-3.5 text-foreground-muted group-hover:text-accent-500 transition-colors shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </a>
              ))}
            </div>
          </div>

          {/* Legal */}
          <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
            <h2 className="font-bold text-foreground text-sm mb-3">Legal &amp; Policies</h2>
            <div className="divide-y divide-border-default">
              {[
                { label: 'Privacy Policy', href: '/legal/privacy-policy' },
                { label: 'Terms & Conditions', href: '/legal/terms-and-conditions' },
                { label: 'Return & Refund Policy', href: '/legal/return-refund-policy' },
                { label: 'Shipping Policy', href: '/legal/shipping-policy' },
                { label: 'Cancellation Policy', href: '/legal/cancellation-policy' },
                { label: 'Warranty Policy', href: '/legal/warranty-policy' },
                { label: 'FAQ', href: '/legal/faq' },
                { label: 'Grievance Redressal', href: '/legal/grievance-redressal' },
              ].map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="flex items-center justify-between py-2 text-sm text-foreground-secondary hover:text-accent-500 transition-colors group"
                >
                  {link.label}
                  <svg className="w-3.5 h-3.5 text-foreground-muted group-hover:text-accent-500 transition-colors shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </a>
              ))}
            </div>
          </div>

        </div>

        {/* Chat — below info strip */}
        <div className="mb-2">
          <p className="text-accent-500 text-xs font-bold uppercase tracking-widest mb-1">Support Chat</p>
          <h2 className="text-xl md:text-2xl font-extrabold text-foreground mb-4">Chat with us</h2>
        </div>
        {user ? (
          <div className="rounded-2xl border border-border-default overflow-hidden shadow-sm" style={{ height: '65vh', minHeight: '480px', maxHeight: '680px' }}>
            <SupportChat />
          </div>
        ) : (
          <div className="bg-surface-elevated rounded-2xl border border-border-default py-16 text-center shadow-sm">
            <div className="w-16 h-16 bg-primary-100 dark:bg-primary-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-foreground mb-2">Sign in to use Support Chat</h2>
            <p className="text-foreground-secondary text-sm mb-6 max-w-sm mx-auto">Log in to chat with our support bot and get help with your orders and account.</p>
            <a href="/login" className="inline-block bg-primary-500 hover:bg-primary-600 text-white px-8 py-2.5 rounded-lg font-semibold text-sm transition-colors">
              Sign In
            </a>
          </div>
        )}

      </div>
    </div>
  )
}
