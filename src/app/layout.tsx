import './globals.css'
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="bg-surface" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var k=location.pathname.startsWith('/admin')?'jeffi-admin-theme':'jeffi-theme';var t=sessionStorage.getItem(k)||localStorage.getItem(k);if(t==='dark'){document.documentElement.classList.add('dark')}}catch(e){}})()`,
          }}
        />
      </head>
      <body className="antialiased bg-surface text-foreground m-0 p-0">
        <Script src="https://www.googletagmanager.com/gtag/js?id=GT-NM2C3M85" strategy="afterInteractive" />
        <Script id="gtag-init" strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','GT-NM2C3M85');`,
          }}
        />
        <ConditionalLayout>{children}</ConditionalLayout>
      </body>
    </html>
  )
}
