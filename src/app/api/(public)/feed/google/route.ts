import { NextRequest, NextResponse } from 'next/server'
import { queryMany } from '@/lib/shared/db'
import { currentBrandNameAsync } from '@/lib/catalog/brand'
import { getStorefrontContent } from '@/lib/catalog/site-controls'
import { buildProductHighlights, buildProductDetails } from '@/lib/shared/google-merchant-helpers'

export const dynamic = 'force-dynamic'

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export async function GET(request: NextRequest) {
  const feedSecret = process.env.FEED_SECRET
  if (feedSecret) {
    const provided = request.headers.get('x-feed-token') || new URL(request.url).searchParams.get('token')
    if (provided !== feedSecret) {
      return new NextResponse('Unauthorized', { status: 401 })
    }
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://jeffistoress.com'

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
    WHERE p.is_draft = false
    ORDER BY p.created_at DESC
  `)

  const items: string[] = []

  for (const product of products) {
    const primaryImage = product.product_images?.find((img: any) => img.is_primary) || product.product_images?.[0]
    const imageUrl = primaryImage?.image_url || ''
    const additionalImages = (product.product_images || [])
      .filter((img: any) => img.id !== primaryImage?.id)
      .map((img: any) => img.image_url)
    const brandName = product.brands?.name || ''
    const description = (product.description || product.name).slice(0, 5000)
    const hasVariants = product.has_variants && product.product_variants?.length > 0
    const productActive = product.is_active !== false

    const highlights = buildProductHighlights(product)
    const details = buildProductDetails(product)

    const cogs = (cost: any): string => {
      const n = Number(cost)
      return n > 0 ? `\n      <g:cost_of_goods_sold>${n.toFixed(2)} INR</g:cost_of_goods_sold>` : ''
    }

    // Shared XML fragments
    const additionalImagesXml = additionalImages
      .map((url: string) => `\n      <g:additional_image_link>${escapeXml(url)}</g:additional_image_link>`)
      .join('')
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

    if (hasVariants) {
      for (const variant of product.product_variants) {
        const sellingPrice = variant.price
        if (sellingPrice == null) continue
        const variantMrp = variant.mrp ? Number(variant.mrp) : product.mrp ? Number(product.mrp) : null
        const hasSalePrice = variantMrp && variantMrp > Number(sellingPrice)
        const variantMpn = variant.mpn || product.mpn || ''
        const variantGtin = variant.gtin || product.gtin || ''
        const availability = !productActive
          ? 'out_of_stock'
          : variant.stock_status === 'Out of Stock'
            ? 'out_of_stock'
            : 'in_stock'

        items.push(`    <item>
      <g:id>${escapeXml(variant.sku)}</g:id>
      <g:item_group_id>${escapeXml(product.sku)}</g:item_group_id>
      <title>${escapeXml(product.name)} - ${escapeXml(variant.variant_name)}</title>
      <description>${escapeXml(description)}</description>
      <link>${baseUrl}/products/${product.slug}?sku=${encodeURIComponent(variant.sku)}</link>
      <g:image_link>${escapeXml(imageUrl)}</g:image_link>${additionalImagesXml}
      <g:price>${Number(variantMrp || sellingPrice).toFixed(2)} INR</g:price>${
        hasSalePrice
          ? `
      <g:sale_price>${Number(sellingPrice).toFixed(2)} INR</g:sale_price>`
          : ''
      }
      <g:availability>${availability}</g:availability>
      <g:condition>new</g:condition>
      <g:identifier_exists>${variantMpn || variantGtin || brandName ? 'yes' : 'no'}</g:identifier_exists>${
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
      }${highlightsXml}${detailsXml}${materialXml}
      <g:size>${escapeXml(variant.variant_name)}</g:size>${cogs(variant.cost_price ?? product.cost_price)}
    </item>`)
      }
    } else {
      const sellingPrice = product.base_price
      const productMrp = product.mrp ? Number(product.mrp) : null
      const hasSalePrice = productMrp && productMrp > Number(sellingPrice)
      const availability = !productActive
        ? 'out_of_stock'
        : product.stock_status === 'Out of Stock'
          ? 'out_of_stock'
          : 'in_stock'

      items.push(`    <item>
      <g:id>${escapeXml(product.sku)}</g:id>
      <title>${escapeXml(product.name)}</title>
      <description>${escapeXml(description)}</description>
      <link>${baseUrl}/products/${product.slug}</link>
      <g:image_link>${escapeXml(imageUrl)}</g:image_link>${additionalImagesXml}
      <g:price>${Number(productMrp || sellingPrice).toFixed(2)} INR</g:price>${
        hasSalePrice
          ? `
      <g:sale_price>${Number(sellingPrice).toFixed(2)} INR</g:sale_price>`
          : ''
      }
      <g:availability>${availability}</g:availability>
      <g:condition>new</g:condition>
      <g:identifier_exists>${product.mpn || product.gtin || brandName ? 'yes' : 'no'}</g:identifier_exists>${
        brandName
          ? `
      <g:brand>${escapeXml(brandName)}</g:brand>`
          : ''
      }${
        product.mpn
          ? `
      <g:mpn>${escapeXml(product.mpn)}</g:mpn>`
          : ''
      }${
        product.gtin
          ? `
      <g:gtin>${escapeXml(product.gtin)}</g:gtin>`
          : ''
      }${highlightsXml}${detailsXml}${materialXml}${
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
