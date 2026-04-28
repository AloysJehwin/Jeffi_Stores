import Link from 'next/link'

export default function AboutPage() {
  return (
    <div className="bg-surface">
      {/* Page Header */}
      <div className="bg-surface-elevated border-b border-border-default">
        <div className="container mx-auto px-4 py-4 sm:py-6 lg:py-8">
          <h1 className="text-3xl md:text-4xl font-bold text-secondary-500 dark:text-foreground mb-2">
            About Jeffi Stores
          </h1>
          <p className="text-foreground-secondary">
            Your trusted partner for industrial hardware and tools
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-12">
        {/* Main Content */}
        <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden mb-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 p-4 sm:p-6 lg:p-8">
            {/* Left Content */}
            <div>
              <h2 className="text-2xl font-bold text-foreground mb-6">Who We Are</h2>
              <div className="prose prose-gray dark:prose-invert">
                <p className="text-foreground-secondary mb-4 leading-relaxed">
                  Jeffi Stores is your trusted hardware partner, offering a wide selection of industrial
                  machinery parts. We guarantee high availability of quality components for manufacturing,
                  construction, and repairs.
                </p>
                <p className="text-foreground-secondary mb-4 leading-relaxed">
                  With years of experience in the hardware industry, we&apos;ve built a reputation for reliability,
                  quality, and exceptional customer service. Our mission is to keep your operations running
                  smoothly with the right tools and parts.
                </p>
                <p className="text-foreground-secondary mb-4 leading-relaxed">
                  We ensure high availability of quality components for manufacturing, construction, and repairs.
                  Count on us for reliable products and expert service to keep your operations seamless!
                </p>
              </div>
            </div>

            {/* Right Content - Stats */}
            <div>
              <h2 className="text-2xl font-bold text-foreground mb-6">Why Choose Us</h2>
              <div className="space-y-6">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-primary-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <svg className="w-6 h-6 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground mb-1">Quality Products</h3>
                    <p className="text-foreground-secondary text-sm">
                      We stock only genuine, high-quality products from trusted brands like TVS, UNBRAKO,
                      Taparia, and more.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-accent-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <svg className="w-6 h-6 text-accent-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground mb-1">24/7 Support</h3>
                    <p className="text-foreground-secondary text-sm">
                      Get round-the-clock assistance with our 24/7 support--always here when you need us!
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground mb-1">Wide Range</h3>
                    <p className="text-foreground-secondary text-sm">
                      From bolts and nuts to power tools and belts, we have everything you need in one place.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <svg className="w-6 h-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground mb-1">Expert Team</h3>
                    <p className="text-foreground-secondary text-sm">
                      Our knowledgeable staff is ready to help you find exactly what you need.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Product Categories */}
        <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 sm:p-6 lg:p-8 mb-8">
          <h2 className="text-2xl font-bold text-foreground mb-6">What We Offer</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {[
              { name: 'Bolts & Nuts', brands: 'TVS, UNBRAKO' },
              { name: 'Screws', brands: 'LandMark' },
              { name: 'Drill Bits', brands: 'Miranda, Totem' },
              { name: 'Tools', brands: 'Taparia, Forves Kento' },
              { name: 'V Belts', brands: 'IPON VEE Grip, Fenner, Nickson, PIX' },
              { name: 'Timing Belts', brands: 'Gates, Fenner, Contitech' },
              { name: 'SS Fasteners', brands: 'APL, Unbrako, TVS, LPS' },
              { name: 'Welding Rods', brands: 'Ador, Esab, Mangalam' },
              { name: 'Valves', brands: 'Spirax, Forves Marshall, Exxon' },
            ].map((item, index) => (
              <div key={index} className="border border-border-default rounded-lg p-4 hover:border-accent-500 transition-colors">
                <h3 className="font-semibold text-foreground mb-2">{item.name}</h3>
                <p className="text-sm text-foreground-secondary">Brands: {item.brands}</p>
              </div>
            ))}
          </div>
          <div className="mt-8 text-center">
            <Link
              href="/categories"
              className="inline-block bg-accent-500 hover:bg-accent-600 text-white px-8 py-3 rounded-lg font-semibold transition-colors"
            >
              View All Categories
            </Link>
          </div>
        </div>

        {/* CTA Section */}
        <div className="bg-gradient-to-r from-primary-600 to-primary-800 rounded-lg shadow-sm p-4 sm:p-6 lg:p-8 text-center text-white">
          <h2 className="text-3xl font-bold mb-4">Ready to Get Started?</h2>
          <p className="text-lg mb-6 text-primary-50">
            Contact us today for all your hardware and industrial tool needs.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/contact"
              className="bg-accent-500 hover:bg-accent-600 text-white px-8 py-3 rounded-lg font-semibold transition-colors"
            >
              Contact Us
            </Link>
            <Link
              href="/products"
              className="bg-surface-elevated text-primary-700 hover:bg-surface-secondary px-8 py-3 rounded-lg font-semibold transition-colors"
            >
              Browse Products
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
