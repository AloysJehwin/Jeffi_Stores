import './globals.css'
import { headers } from 'next/headers'
import ConditionalLayout from '@/components/ConditionalLayout'
import Script from 'next/script'

export const metadata = {
  title: 'Jeffi Stores - Industrial Hardware & Tools',
  description: 'Your trusted hardware partner for industrial machinery parts, tools, and equipment',
  icons: {
    icon: '/icon.png',
    apple: '/apple-icon.png',
  },
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const host = headers().get('host') || ''
  const isFormsSubdomain = host.startsWith('forms.')
  return (
    <html lang="en" className="bg-surface overscroll-none" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=sessionStorage.getItem('jeffi-theme')||localStorage.getItem('jeffi-theme')||sessionStorage.getItem('jeffi-admin-theme')||localStorage.getItem('jeffi-admin-theme');if(t==='dark'){document.documentElement.classList.add('dark')}else if(t==='light'){document.documentElement.classList.remove('dark')}}catch(e){}})()`,
          }}
        />
      </head>
      <body className="antialiased bg-surface text-foreground m-0 p-0 overscroll-none">
        <Script src="https://www.googletagmanager.com/gtag/js?id=GT-NM2C3M85" strategy="afterInteractive" />
        <Script id="gtag-init" strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','GT-NM2C3M85');`,
          }}
        />
        <ConditionalLayout isFormsSubdomain={isFormsSubdomain}>{children}</ConditionalLayout>
      </body>
    </html>
  )
}
