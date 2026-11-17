import type { ProductQuery } from '../composed'
import type { CodeNode } from '../code/ast'
import type { StoreSocialNetwork } from '@/lib/catalog/store-socials'
import type { ShowcaseView } from '../../showcase/types'

// What code sections read: the store's catalogue as flat, render-ready views. Prices come formatted and as numbers.

export type { ProductQuery }

export interface Money {
  value: number
  formatted: string
}

/** The `<Products>` binding. */
export interface ProductView {
  id: string
  slug: string
  name: string
  url: string
  image: string | null
  hoverImage: string | null
  price: Money
  mrp: Money | null
  /** Off MRP, whole percent; 0 when not on sale. */
  discountPct: number
  badge: string | null
  brand: string | null
  category: string | null
  inStock: boolean
  rating: number | null
  reviewCount: number
  // For ProductCard and links; not part of the AI's binding.
  hasVariants: boolean
  brandSlug: string | null
  categorySlug: string | null
  categoryId: string | null
  isDigital: boolean
}

export interface ProductDetailView extends ProductView {
  description: string
  shortDescription: string
  images: string[]
  attributes: { name: string; value: string }[]
}

export interface CategoryView {
  id: string
  slug: string
  name: string
  url: string
  image: string | null
}

export interface BrandView {
  id: string
  slug: string
  name: string
  url: string
  logo: string | null
}

/** A subcategory (`<SubCategories>`, and each `<AllCategories>` entry's children). */
export interface SubCategoryView extends CategoryView {
  /** Products in it and its own subcategories. */
  productCount: number
}

/** The `<Category>` binding: the category page's own category. */
export interface CategoryPageView {
  id: string
  slug: string
  name: string
  url: string
  description: string
  tagline: string
  /** The hero picture, else the category's own picture. */
  image: string | null
  mobileImage: string | null
  /** Where the hero picture links. */
  bannerUrl: string | null
  parentName: string | null
  parentUrl: string | null
  productCount: number
  // For SubCategories, CategoryFaqs and SeoText; not part of the binding.
  children: SubCategoryView[]
  faqs: { id: string; question: string; answer: string }[]
  seoText: string
}

/** The `<Brand>` binding: the brand page's own brand. */
export interface BrandPageView {
  id: string
  slug: string
  name: string
  url: string
  logo: string | null
  tagline: string
  description: string
  story: string
  website: string | null
  /** "#rrggbb", or null. */
  color: string | null
  /** The banner picture. */
  image: string | null
  mobileImage: string | null
  founded: string | null
  headquarters: string | null
  /** Country of origin, by name. */
  origin: string | null
  socials: { network: string; label: string; href: string }[]
  productCount: number
  // For SeoText; not part of the binding.
  seoText: string
}

/** `<AllCategories>` entries: a top-level category with its subcategories. */
export interface CategoryIndexView extends SubCategoryView {
  tagline: string
  description: string
  children: SubCategoryView[]
}

/** `<AllBrands>` entries. */
export interface BrandIndexView extends BrandView {
  tagline: string
  description: string
  productCount: number
  featured: boolean
}

/** `<SearchQuery>`: what the search page searched for. */
export interface SearchView {
  term: string
  total: number
}

export interface ReviewView {
  id: string
  rating: number
  /** "★★★★☆" */
  stars: string
  title: string | null
  comment: string
  author: string
  productName: string
  productSlug: string
  productUrl: string
}

export interface OfferView {
  id: string
  slug: string
  title: string
  subtitle: string | null
  badge: string | null
  image: string | null
  mobileImage: string | null
  url: string
  cta: string | null
  endsAt: string | null
}

/** A network the store links to: 'instagram' | 'facebook' | 'youtube' | 'x' | 'linkedin' | 'pinterest'. */
export type { StoreSocialNetwork }

export interface StoreView {
  name: string
  tagline: string
  logo: string | null
  email: string
  phone: string
  address: string
  about: string
  year: number
  /** WhatsApp number: digits with the country code ('919876543210'). Absent when not set. */
  whatsapp?: string
  /** Profile links (absolute https URLs), only the networks the store set. Absent when none. */
  socials?: Partial<Record<StoreSocialNetwork, string>>
}

export interface SiteData {
  /** The onboarding studio's made-up catalogue: missing pictures show as labelled placeholders, not quiet fills. */
  sample?: boolean
  products(q: ProductQuery): Promise<ProductView[]>
  product(slug: string): Promise<ProductDetailView | null>
  categories(q: { parent?: string | null; slugs?: string[]; limit: number }): Promise<CategoryView[]>
  brands(q: { slugs?: string[]; featured?: boolean; limit: number }): Promise<BrandView[]>
  reviews(q: { productSlug?: string; minRating: number; limit: number }): Promise<ReviewView[]>
  offers(q: { limit: number }): Promise<OfferView[]>
  store(): Promise<StoreView>
  /** A category with its subcategories, FAQs and SEO copy (the category page's parts off a category page). */
  category(slug: string): Promise<CategoryPageView | null>
  brand(slug: string): Promise<BrandPageView | null>
  /** Every top-level category with its subcategories (the all-categories page). */
  allCategories(): Promise<CategoryIndexView[]>
  /** Every brand, featured first (the all-brands page). */
  allBrands(): Promise<BrandIndexView[]>
  /** The product card lists draw with: a preview sets it (null for none); unset, the live store's own is read. */
  card?: SiteCardSection | null
  /** A Showcase site's business and content (lib/showcase/site-data.ts); absent on a store. */
  showcase?(): Promise<ShowcaseView | null>
}

/** The site's product card: the `card` page's code section, compiled (lib/site/card.ts). */
export interface SiteCardSection {
  id: string
  ast: CodeNode
  css: string
}

/** The made-up catalogue the onboarding studio previews a site with (lib/site/studio sampleCatalog). */
export interface SampleCatalog {
  store: {
    name: string
    tagline?: string
    logo?: string | null
    email?: string
    phone?: string
    address?: string
    about?: string
    whatsapp?: string
    socials?: Partial<Record<StoreSocialNetwork, string>>
  }
  categories: {
    slug: string
    name: string
    image?: string | null
    parent?: string | null
    description?: string
    tagline?: string
    faqs?: { question: string; answer: string }[]
    seo?: string
  }[]
  brands: { slug: string; name: string; logo?: string | null; featured?: boolean; tagline?: string; description?: string; story?: string; website?: string | null }[]
  products: {
    slug: string
    name: string
    price: number
    mrp?: number | null
    /** A category slug. */
    category: string
    /** A brand slug. */
    brand?: string | null
    images?: string[]
    /** What to generate when there is no image yet. */
    imagePrompt?: string
    description?: string
    attributes?: Record<string, string> | { name: string; value: string }[]
    featured?: boolean
    inStock?: boolean
    badge?: string | null
  }[]
  reviews: { productSlug: string; rating: number; title?: string | null; comment: string; author: string }[]
  offers?: { slug: string; title: string; subtitle?: string | null; badge?: string | null; image?: string | null; endsAt?: string | null; cta?: string | null }[]
}
