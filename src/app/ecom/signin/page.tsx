import Script from 'next/script'
import OwnerAuthForm from '../OwnerAuthForm'

export const dynamic = 'force-dynamic'

export default function EcomSignInPage() {
  return (
    <div className="py-16 px-4">
      <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" />
      <OwnerAuthForm mode="signin" />
    </div>
  )
}
