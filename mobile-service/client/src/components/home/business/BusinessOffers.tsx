import ProductRowSection, { type RowStyle } from '../ProductRowSection'
import { useBusinessHome } from './useBusinessHome'
import type { SectionProps } from '../../../types/home'

// Products on a business discount (picked by the admin, or the business's discounted categories), as a product row.

const COPY = { eyebrow: 'Business prices', title: 'Your business offers' }

export default function BusinessOffers({ section, data, style }: SectionProps & { style: RowStyle }) {
  const { data: home } = useBusinessHome(section, data)
  const products = home?.offers?.[section.id] ?? []
  if (products.length === 0) return null
  return (
    <ProductRowSection
      title={section.copy.title || COPY.title}
      eyebrow={section.copy.eyebrow ?? COPY.eyebrow}
      products={products}
      carousel={section.layout === 'carousel'}
      style={style}
      aspect={section.aspect}
    />
  )
}
