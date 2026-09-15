import ProductCard from '@/components/visitor/ProductCard'
import DealCountdown from './DealCountdown'
import { productCardProps } from '@/lib/product-card-props'

interface DealOfTheDayProps {
  products: any[]
  gstEnabled: boolean
  title?: string | null
  eyebrow?: string | null
  countdownEndsAt?: string | null
}

export default function DealOfTheDay({ products, gstEnabled, title, eyebrow, countdownEndsAt }: DealOfTheDayProps) {
  const heading = title ?? 'Deal of the Day'
  const endsAt = countdownEndsAt && Date.parse(countdownEndsAt) > Date.now() ? countdownEndsAt : null

  return (
    <section className="py-12 md:py-20 bg-surface-secondary">
      <div className="container mx-auto px-4">
        <div className="flex items-end justify-between gap-4 mb-7">
          <div className="flex items-center gap-4">
            <div className="w-1 h-10 bg-primary-500 rounded-full" />
            <div>
              <p className="text-primary-500 text-[10px] font-black uppercase tracking-[0.2em] mb-1">{eyebrow ?? 'Limited Time'}</p>
              <h2 className="text-2xl md:text-4xl font-black text-foreground tracking-tight">{heading}</h2>
            </div>
          </div>
          {endsAt && <DealCountdown endsAt={endsAt} />}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5">
          {products.map((product: any) => (
            <ProductCard key={product.id} {...productCardProps(product, gstEnabled)} />
          ))}
        </div>
      </div>
    </section>
  )
}
