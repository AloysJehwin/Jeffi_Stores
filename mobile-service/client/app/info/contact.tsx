import { Redirect } from 'expo-router'

// The web's /contact redirects to /support, which carries the contact details and the support chat.
export default function ContactScreen() {
  return <Redirect href="/info/support" />
}
