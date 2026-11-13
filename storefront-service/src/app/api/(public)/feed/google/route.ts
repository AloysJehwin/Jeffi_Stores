import { catalogBaseUrl } from '@/lib/shared/customer-links'
import { NextRequest, NextResponse } from 'next/server'
import { queryMany } from '@/lib/shared/db'
import { loadProductMediaMany, resolveImageUrls } from '@/lib/catalog/product-media'
import { currentBrandNameAsync } from '@/lib/catalog/brand'
import { getStorefrontContent } from '@/lib/catalog/site-controls'
import { buildProductHighlights, buildProductDetails } from '@/lib/shared/google-merchant-helpers'
import { gmcAgeGroup, gmcCondition, gmcGender, gmcMultipack } from '@/lib/merchant/attributes'
import { clipTitle, hasIdentifiers, listedPrices } from '@/lib/merchant/item-rules'

export const dynamic = 'force-dynamic'

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function priceXml(selling: number, mrp: number | null): string {
  const { price, salePrice } = listedPrices(selling, mrp)
  return (
    `\n      <g:price>${price.toFixed(2)} INR</g:price>` +
    (salePrice != null ? `\n      <g:sale_price>${salePrice.toFixed(2)} INR</g:sale_price>` : '')
  )
}

export async function GET(request: NextRequest) {
  const feedSecret = process.env.FEED_SECRET
  if (feedSecret) {
    const provided = request.headers.get('x-feed-token') || new URL(request.url).searchParams.get('token')
    if (provided !== feedSecret) {
      return new NextResponse('Unauthorized', { status: 401 })
    }
  }

  const baseUrl = await catalogBaseUrl()

  const products = await queryMany(`
    SELECT p.*,
      json_build_object(
        'id', c.id, 'name', c.name, 'slug', c.slug,
        'google_product_category', c.google_product_category,
        'parent_name', pc.name,
        'parent_google_product_category', pc.google_product_category
      ) AS categories,
      json_build_object('id', b.id, 'name', b.name) AS brands,
      COALESCE(
        (SELECT json_agg(pi ORDER BY pi.display_order)
         FROM product_images pi WHERE pi.product_id = p.id),
        '[]'::json
      ) AS product_images,
      COALESCE(
        (SELECT json_agg(pv ORDER BY pv.variant_name)
         FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true),
        '[]'::json
      ) AS product_variants
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN categories pc ON c.parent_category_id = pc.id
    LEFT JOIN brands b ON p.brand_id = b.id
    WHERE p.is_draft = false AND p.is_digital = false
    ORDER BY p.created_at DESC
  `)

  const items: string[] = []
  // product_media images (primary first), with variant / sub-variant inheritance.
  const mediaByProduct = await loadProductMediaMany(products.map((p: any) => p.id))

  for (const product of products) {
    const primaryImage = product.product_images?.find((img: any) => img.is_primary) || product.product_images?.[0]
    const media = mediaByProduct.get(product.id) ?? []
    const fromMedia = resolveImageUrls(media)
    const imageUrl = fromMedia[0] || primaryImage?.image_url || ''
    const additionalImages = fromMedia.length
      ? fromMedia.slice(1, 11)
      : (product.product_images || []).filter((img: any) => img.id !== primaryImage?.id).map((img: any) => img.image_url)
    const imagesXmlFor = (urls: string[]) =>
      urls.map(url => `\n      <g:additional_image_link>${escapeXml(url)}</g:additional_image_link>`).join('')
    const brandName = product.brands?.name || ''
    const description = (product.description || product.ai_description || product.short_description || product.name).slice(0, 5000)
    const hasVariants = product.has_variants && product.product_variants?.length > 0
    const productActive = product.is_active !== false

    const highlights = buildProductHighlights(product)
    const details = buildProductDetails(product)

    // Cost of goods only in a token-protected feed: an open feed URL would show the store's costs to anyone.
    const cogs = (cost: any): string => {
      if (!feedSecret) return ''
      const n = Number(cost)
      return n > 0 ? `\n      <g:cost_of_goods_sold>${n.toFixed(2)} INR</g:cost_of_goods_sold>` : ''
    }

    // Shared XML fragments
    const additionalImagesXml = imagesXmlFor(additionalImages)
    const highlightsXml = highlights
      .map(h => `\n      <g:product_highlight>${escapeXml(h)}</g:product_highlight>`)
      .join('')
    const detailsXml = details
      .map(
        d =>
          `\n      <g:product_detail>\n        <g:section_name>${escapeXml(d.section)}</g:section_name>\n        <g:attribute_name>${escapeXml(d.attribute)}</g:attribute_name>\n        <g:attribute_value>${escapeXml(d.value)}</g:attribute_value>\n      </g:product_detail>`
      )
      .join('')
    const materialXml = product.material ? `\n      <g:material>${escapeXml(product.material)}</g:material>` : ''
    const gender = gmcGender(product)
    const multipack = gmcMultipack(product)
    const attrsXml =
      `\n      <g:age_group>${gmcAgeGroup(product)}</g:age_group>` +
      (gender ? `\n      <g:gender>${gender}</g:gender>` : '') +
      (product.color ? `\n      <g:color>${escapeXml(product.color)}</g:color>` : '') +
      (multipack ? `\n      <g:multipack>${multipack}</g:multipack>` : '') +
      (product.is_bundle ? `\n      <g:is_bundle>yes</g:is_bundle>` : '')
    const condition = gmcCondition(product)
    const productMpn = product.mpn || product.brand_part_number || product.model_number || ''

    if (hasVariants) {
      for (const variant of product.product_variants) {
        const sellingPrice = variant.price
        if (sellingPrice == null) continue
        const variantMrp = variant.mrp ? Number(variant.mrp) : product.mrp ? Number(product.mrp) : null
        const variantMpn = variant.mpn || productMpn
        const variantGtin = variant.gtin || product.gtin || ''
        const availability = !productActive
          ? 'out_of_stock'
          : variant.stock_status === 'Out of Stock'
            ? 'out_of_stock'
            : 'in_stock'

        // A variant with its own images lists them first.
        const own = resolveImageUrls(media, { variantId: variant.id })
        const vImage = own[0] || imageUrl
        const vAdditionalXml = own.length && own[0] !== fromMedia[0] ? imagesXmlFor(own.slice(1, 11)) : additionalImagesXml
        items.push(`    <item>
      <g:id>${escapeXml(variant.sku)}</g:id>
      <g:item_group_id>${escapeXml(product.sku)}</g:item_group_id>
      <title>${escapeXml(clipTitle(`${product.name} - ${variant.variant_name}`))}</title>
      <description>${escapeXml(description)}</description>
      <link>${baseUrl}/products/${product.slug}?sku=${encodeURIComponent(variant.sku)}</link>
      <g:image_link>${escapeXml(vImage)}</g:image_link>${vAdditionalXml}${priceXml(Number(sellingPrice), variantMrp)}
      <g:availability>${availability}</g:availability>
      <g:condition>${condition}</g:condition>
      <g:identifier_exists>${hasIdentifiers(variantGtin, variantMpn, brandName) ? 'yes' : 'no'}</g:identifier_exists>${
        brandName
          ? `
      <g:brand>${escapeXml(brandName)}</g:brand>`
          : ''
      }${
        variantMpn
          ? `
      <g:mpn>${escapeXml(variantMpn)}</g:mpn>`
          : ''
      }${
        variantGtin
          ? `
      <g:gtin>${escapeXml(variantGtin)}</g:gtin>`
          : ''
      }${highlightsXml}${detailsXml}${materialXml}${attrsXml}
      <g:size>${escapeXml(variant.variant_name)}</g:size>${cogs(variant.cost_price ?? product.cost_price)}
    </item>`)
      }
    } else {
      const sellingPrice = product.base_price
      const productMrp = product.mrp ? Number(product.mrp) : null
      const availability = !productActive
        ? 'out_of_stock'
        : product.stock_status === 'Out of Stock'
          ? 'out_of_stock'
          : 'in_stock'

      items.push(`    <item>
      <g:id>${escapeXml(product.sku)}</g:id>
      <title>${escapeXml(clipTitle(product.name || ''))}</title>
      <description>${escapeXml(description)}</description>
      <link>${baseUrl}/products/${product.slug}</link>
      <g:image_link>${escapeXml(imageUrl)}</g:image_link>${additionalImagesXml}${priceXml(Number(sellingPrice), productMrp)}
      <g:availability>${availability}</g:availability>
      <g:condition>${condition}</g:condition>
      <g:identifier_exists>${hasIdentifiers(product.gtin, productMpn, brandName) ? 'yes' : 'no'}</g:identifier_exists>${
        brandName
          ? `
      <g:brand>${escapeXml(brandName)}</g:brand>`
          : ''
      }${
        productMpn
          ? `
      <g:mpn>${escapeXml(productMpn)}</g:mpn>`
          : ''
      }${
        product.gtin
          ? `
      <g:gtin>${escapeXml(product.gtin)}</g:gtin>`
          : ''
      }${highlightsXml}${detailsXml}${materialXml}${attrsXml}${
        product.size
          ? `
      <g:size>${escapeXml(product.size)}</g:size>`
          : ''
      }${cogs(product.cost_price)}
    </item>`)
    }
  }

  const brand = await currentBrandNameAsync()
  const storefront = await getStorefrontContent()
  const channelDescription = storefront.metaDescription || storefront.metaTagline || `Shop products from ${brand}`

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>${escapeXml(brand)}</title>
    <link>${baseUrl}</link>
    <description>${escapeXml(channelDescription)}</description>
${items.join('\n')}
  </channel>
</rss>`

  return new NextResponse(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
