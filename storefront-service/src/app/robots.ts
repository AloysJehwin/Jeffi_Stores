export { default } from '@/app-shell/robots'

// Per-host (custom domains), so never prerendered at build time.
export const dynamic = 'force-dynamic'
