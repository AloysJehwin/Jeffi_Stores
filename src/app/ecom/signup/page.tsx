import Script from 'next/script'
import OwnerAuthForm from '../OwnerAuthForm'

export const dynamic = 'force-dynamic'

export default function EcomSignUpPage() {
  return (
    <div className="py-16 px-4">
      <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" />
      <OwnerAuthForm mode="signup" />
    </div>
  )
}
