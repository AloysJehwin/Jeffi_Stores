import Link from 'next/link'

export const metadata = {
  title: 'Return Policy - Jeffi Stores',
  description: 'Return policy for Jeffi Stores. We accept returns of defective products only. No exchanges.',
}

export default function ReturnPolicyPage() {
  return (
    <div className="bg-surface">
      {/* Page Header */}
      <div className="bg-surface-elevated border-b border-border-default">
        <div className="container mx-auto px-4 py-4 sm:py-6 lg:py-8">
          <h1 className="text-3xl md:text-4xl font-bold text-secondary-500 mb-2">
            Return Policy
          </h1>
          <p className="text-foreground-secondary">
            Please read our return policy carefully before making a purchase
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-12 max-w-4xl">
        {/* Key Highlights */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 mb-8">
          <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg p-4 sm:p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-green-100 dark:bg-green-800/50 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="font-semibold text-green-800 dark:text-green-300">Returns Accepted</h3>
            </div>
            <p className="text-green-700 dark:text-green-300 text-sm">
              We accept returns for defective or damaged products only.
            </p>
          </div>

          <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4 sm:p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-red-100 dark:bg-red-800/50 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h3 className="font-semibold text-red-800 dark:text-red-300">No Exchanges</h3>
            </div>
            <p className="text-red-700 dark:text-red-300 text-sm">
              We do not offer exchanges on any products.
            </p>
          </div>
        </div>

        {/* Detailed Policy */}
        <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default overflow-hidden">
          <div className="p-4 sm:p-6 lg:p-8 space-y-8">
            {/* Section 1 */}
            <div>
              <h2 className="text-xl font-bold text-foreground mb-4">1. Defective Product Returns</h2>
              <p className="text-foreground-secondary mb-4 leading-relaxed">
                At Jeffi Stores, we are committed to delivering quality products. If you receive a product
                that is defective, damaged, or not functioning as intended, you may request a return for a
                full refund.
              </p>
              <ul className="space-y-2 text-foreground-secondary">
                <li className="flex items-start gap-2">
                  <svg className="w-5 h-5 text-accent-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  The product must be reported as defective within <strong>7 days</strong> of delivery.
                </li>
                <li className="flex items-start gap-2">
                  <svg className="w-5 h-5 text-accent-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  You must provide photographs or a video clearly showing the defect.
                </li>
                <li className="flex items-start gap-2">
                  <svg className="w-5 h-5 text-accent-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  The product must be unused and in its original packaging.
                </li>
                <li className="flex items-start gap-2">
                  <svg className="w-5 h-5 text-accent-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  The original invoice or order number must be provided.
                </li>
              </ul>
            </div>

            {/* Section 2 */}
            <div>
              <h2 className="text-xl font-bold text-foreground mb-4">2. No Exchange Policy</h2>
              <p className="text-foreground-secondary leading-relaxed">
                We do not accept exchanges for any products. If you have received a defective item, you
                may return it for a refund as described above. Please ensure you select the correct product
                specifications (size, type, quantity) before placing your order.
              </p>
            </div>

            {/* Section 3 */}
            <div>
              <h2 className="text-xl font-bold text-foreground mb-4">3. How to Request a Return</h2>
              <div className="space-y-4">
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-bold text-primary-600">1</span>
                  </div>
                  <div>
                    <h4 className="font-semibold text-foreground">Contact Us</h4>
                    <p className="text-foreground-secondary text-sm">
                      Reach out to our support team via the <Link href="/contact" className="text-accent-500 hover:text-accent-600 font-medium">Contact Page</Link> or
                      call us with your order details.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-bold text-primary-600">2</span>
                  </div>
                  <div>
                    <h4 className="font-semibold text-foreground">Submit Evidence</h4>
                    <p className="text-foreground-secondary text-sm">
                      Provide photos or video of the defective product along with your order number and invoice.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-bold text-primary-600">3</span>
                  </div>
                  <div>
                    <h4 className="font-semibold text-foreground">Approval & Pickup</h4>
                    <p className="text-foreground-secondary text-sm">
                      Once approved, we will arrange for the product to be picked up or provide instructions for return shipping.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-bold text-primary-600">4</span>
                  </div>
                  <div>
                    <h4 className="font-semibold text-foreground">Refund Processed</h4>
                    <p className="text-foreground-secondary text-sm">
                      After we receive and inspect the returned product, a refund will be processed to your
                      original payment method within 7-10 business days.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Section 4 */}
            <div>
              <h2 className="text-xl font-bold text-foreground mb-4">4. Non-Returnable Items</h2>
              <p className="text-foreground-secondary mb-4 leading-relaxed">
                The following items are not eligible for return:
              </p>
              <ul className="space-y-2 text-foreground-secondary">
                <li className="flex items-start gap-2">
                  <svg className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Products that have been used, installed, or altered.
                </li>
                <li className="flex items-start gap-2">
                  <svg className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Products returned without original packaging.
                </li>
                <li className="flex items-start gap-2">
                  <svg className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Custom or special-order items.
                </li>
                <li className="flex items-start gap-2">
                  <svg className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Products reported after the 7-day return window.
                </li>
              </ul>
            </div>

            {/* Section 5 */}
            <div>
              <h2 className="text-xl font-bold text-foreground mb-4">5. Refund Details</h2>
              <ul className="space-y-2 text-foreground-secondary">
                <li className="flex items-start gap-2">
                  <svg className="w-5 h-5 text-accent-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  Refunds are issued to the original payment method only.
                </li>
                <li className="flex items-start gap-2">
                  <svg className="w-5 h-5 text-accent-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  Refund processing takes 7-10 business days after the returned product is received and inspected.
                </li>
                <li className="flex items-start gap-2">
                  <svg className="w-5 h-5 text-accent-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  Shipping charges are non-refundable unless the defect was due to our error.
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="bg-gradient-to-r from-primary-600 to-primary-800 rounded-lg shadow-sm p-4 sm:p-6 lg:p-8 text-center text-white mt-8">
          <h2 className="text-2xl font-bold mb-3">Have a Question About Returns?</h2>
          <p className="text-primary-50 mb-6">
            Our support team is available 24/7 to help you with any return-related queries.
          </p>
          <Link
            href="/contact"
            className="bg-accent-500 hover:bg-accent-600 text-white px-8 py-3 rounded-lg font-semibold transition-colors inline-block"
          >
            Contact Support
          </Link>
        </div>
      </div>
    </div>
  )
}
