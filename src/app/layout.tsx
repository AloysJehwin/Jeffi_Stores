import './globals.css'
import ConditionalLayout from '@/components/ConditionalLayout'

export const metadata = {
  title: 'Jeffi Stores - Industrial Hardware & Tools',
  description: 'Your trusted hardware partner for industrial machinery parts, tools, and equipment',
  icons: {
    icon: '/icon.png',
    apple: '/apple-icon.png',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="bg-surface" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('jeffi-theme');if(t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme:dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}})()`,
          }}
        />
      </head>
      <body className="antialiased bg-surface text-foreground m-0 p-0">
        <ConditionalLayout>{children}</ConditionalLayout>
      </body>
    </html>
  )
}
