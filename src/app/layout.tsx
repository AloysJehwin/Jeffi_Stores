import './globals.css'

export const metadata = {
  title: 'Jeffi Stores - Industrial Hardware & Tools',
  description: 'Your trusted hardware partner for industrial machinery parts, tools, and equipment',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
