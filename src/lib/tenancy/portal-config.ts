// Per-surface configuration for the shared portal UI (nav, sign-in copy, brand panel, endpoints).
// Each surface is configured independently; the shell picks the mobile or desktop tree at runtime.

export interface PortalAuthEndpoints {
  google: string
  otpStart: string
  otpVerify: string
  logout: string
}

export interface PortalSurfaceConfig {
  navTitle: string
  homeHref: string
  successHref: string
  auth: PortalAuthEndpoints
  signIn: { heading: string; description: string; footnote?: string; emailHint: string }
  brand: { badge: string; heading: string; points: string[]; footnote?: string; mobileIntro?: string }
}

export const CERT_PORTAL: PortalSurfaceConfig = {
  navTitle: 'Certificate Portal',
  homeHref: '/',
  successHref: '/certs',
  auth: {
    google: '/api/certportal/auth/google',
    otpStart: '/api/certportal/auth/otp/start',
    otpVerify: '/api/certportal/auth/otp/verify',
    logout: '/api/certportal/auth/logout',
  },
  signIn: {
    heading: 'Admin Certificate Portal',
    description: 'Sign in with the account you were invited on to download your admin certificate.',
    footnote: 'You can download a certificate once. Save it somewhere safe when you do.',
    emailHint: 'The email your invitation was sent to',
  },
  brand: {
    badge: 'Certificate Portal',
    heading: 'Your admin certificate, safely in your hands.',
    points: [
      'Download your admin certificate securely',
      'Sign in with Google or a one-time email code',
      'One-time download - no certificate is emailed',
      'Step-by-step install help included',
    ],
    footnote: 'Certificates are never sent by email - you download yours here, once.',
    mobileIntro: 'Download and install your admin certificate on this device.',
  },
}

export const STAFF_NOTES: PortalSurfaceConfig = {
  navTitle: 'Staff Notes',
  homeHref: '/staff/notes',
  successHref: '/staff/notes',
  auth: {
    google: '/api/staff/auth/google',
    otpStart: '/api/staff/auth/start',
    otpVerify: '/api/staff/auth/verify',
    logout: '/api/staff/auth/logout',
  },
  signIn: {
    heading: 'Staff Notes',
    description: 'Sign in with your admin account to add photos and notes to a customer. No certificate needed.',
    emailHint: 'Your admin email for this store',
  },
  brand: {
    badge: 'Staff Notes',
    heading: 'Capture what the customer told you, right where it happened.',
    points: [
      'Photograph handwritten notes, sketches and measurements',
      'Record a quick voice memo',
      'Link the note to an order or return',
      'Everything lands on the customer profile for the whole team',
    ],
    footnote: 'Notes stay internal unless you choose to share one with the customer.',
    mobileIntro: 'Add photos, voice memos and notes to a customer profile.',
  },
}
