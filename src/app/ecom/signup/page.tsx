import OwnerAuthForm from '../OwnerAuthForm'

export const dynamic = 'force-dynamic'

export default function EcomSignUpPage() {
  return (
    <div className="py-16 px-4">
      <OwnerAuthForm mode="signup" />
    </div>
  )
}
