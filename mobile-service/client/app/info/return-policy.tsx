import { Redirect } from 'expo-router'

// The web's /return-policy redirects to the policy page.
export default function ReturnPolicyScreen() {
  return <Redirect href="/legal/return-refund-policy" />
}
