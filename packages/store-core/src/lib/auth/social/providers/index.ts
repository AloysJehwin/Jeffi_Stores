import type { SocialProvider } from '../types'
import type { SocialProviderModule } from './shared'
import { google } from './google'
import { facebook } from './facebook'
import { github } from './github'
import { apple } from './apple'

export const SOCIAL_PROVIDER_MODULES: Record<SocialProvider, SocialProviderModule> = { google, facebook, github, apple }

export { SocialProviderError } from './shared'
