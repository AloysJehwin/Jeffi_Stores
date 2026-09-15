import Link from 'next/link'

interface AboutSectionProps {
  aboutCopy: string
  stats: { value: string; label: string }[]
  storeName: string
}

export default function AboutSection({ aboutCopy, stats, storeName }: AboutSectionProps) {
  return (
    <section className="py-12 md:py-20 bg-surface">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-20 items-center">
          <div className="relative rounded-2xl overflow-hidden shadow-2xl">
            <img
              src="/images/Working.png"
              alt={`${storeName} team`}
              className="w-full h-56 sm:h-80 md:h-[440px] object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-secondary-900/60 via-transparent to-transparent" />
            <div className="absolute bottom-4 left-4 right-4 flex gap-3">
              {stats.map((s, i) => (
                <div key={i} className="bg-white/10 backdrop-blur-md rounded-xl px-4 py-3 border border-white/15 flex-1">
                  <p className="text-white font-black text-2xl">{s.value}</p>
                  <p className="text-white/60 text-xs font-semibold mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-5">
            <div>
              <p className="text-primary-500 text-[10px] font-black uppercase tracking-[0.2em] mb-2">About Us</p>
              <h2 className="text-2xl md:text-5xl font-black text-foreground leading-tight">
                Your Trusted<br />Hardware Partner
              </h2>
            </div>
            <p className="text-sm md:text-base text-foreground-secondary leading-relaxed">
              {aboutCopy}
            </p>
            <p className="text-sm md:text-base text-foreground-secondary leading-relaxed">
              We combine product breadth with expert service so your operations stay seamless and efficient.
            </p>

            <div className="flex flex-wrap gap-3 pt-2">
              <Link
                href="/about"
                className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-6 py-3 rounded-xl font-bold transition-all text-sm shadow-lg shadow-primary-500/20"
              >
                Learn More
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </Link>
              <Link
                href="/products"
                className="inline-flex items-center gap-2 border border-border-default hover:border-primary-400 text-foreground px-6 py-3 rounded-xl font-bold transition-all text-sm"
              >
                Browse Products
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
