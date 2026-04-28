import Link from 'next/link'

export default function Footer() {
  return (
    <footer className="bg-secondary-800 text-white">
      <div className="container mx-auto px-4 py-6 pb-20 md:pb-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">

          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-8 h-8 bg-accent-500 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">JS</span>
            </div>
            <span className="font-bold text-base">Jeffi Stores</span>
          </div>

          <div className="flex flex-wrap gap-x-5 gap-y-1">
            <Link href="/" className="text-gray-300 hover:text-accent-400 text-sm transition-colors">Home</Link>
            <Link href="/products" className="text-gray-300 hover:text-accent-400 text-sm transition-colors">Products</Link>
            <Link href="/categories" className="text-gray-300 hover:text-accent-400 text-sm transition-colors">Categories</Link>
            <Link href="/about" className="text-gray-300 hover:text-accent-400 text-sm transition-colors">About Us</Link>
            <Link href="/contact" className="text-gray-300 hover:text-accent-400 text-sm transition-colors">Contact</Link>
          </div>

          <div className="flex flex-col gap-1 text-sm text-gray-300">
            <a href="mailto:jeffistoress@gmail.com" className="hover:text-accent-400 transition-colors">jeffistoress@gmail.com</a>
            <a href="tel:+918903031299" className="hover:text-accent-400 transition-colors">+91 89030 31299</a>
          </div>

        </div>

        <div className="border-t border-gray-700 mt-5 pt-4">
          <p className="text-gray-400 text-xs text-center md:text-left">
            © {new Date().getFullYear()} Jeffi Stores. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  )
}
