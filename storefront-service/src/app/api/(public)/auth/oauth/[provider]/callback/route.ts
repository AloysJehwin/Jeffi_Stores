import { socialCallbackGET, socialCallbackPOST } from '@/lib/auth/social/routes'

export const dynamic = 'force-dynamic'

// Apple returns by form_post; every other provider by GET.
export const GET = socialCallbackGET
export const POST = socialCallbackPOST
