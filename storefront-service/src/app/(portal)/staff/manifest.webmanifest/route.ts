import { NextResponse } from 'next/server'

export const dynamic = 'force-static'

// Installable "Staff Notes" app: opens straight on the capture form.
export function GET() {
  return NextResponse.json(
    {
      name: 'Staff Notes',
      short_name: 'Staff Notes',
      start_url: '/staff/notes',
      scope: '/staff/',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: '#111827',
      icons: [{ src: '/icon.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }],
    },
    { headers: { 'Content-Type': 'application/manifest+json' } }
  )
}
