import '@/styles/globals.css'
import type { ReactNode } from 'react'

export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' }

// A Showcase is always the light scheme; its theme (fonts, colours, shape) is set on the page's wrapper.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="bg-surface">
      <body className="antialiased m-0 p-0 bg-surface text-foreground">{children}</body>
    </html>
  )
}
