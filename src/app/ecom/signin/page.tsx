import OwnerAuthForm from '../OwnerAuthForm'

export const dynamic = 'force-dynamic'

export default function EcomSignInPage() {
  return (
    <div className="py-16 px-4">
      <OwnerAuthForm mode="signin" />
    </div>
  )
}
