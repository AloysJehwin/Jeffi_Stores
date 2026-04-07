import { NextResponse } from 'next/server'
import { queryMany } from '@/lib/db'

export const dynamic = 'force-dynamic'

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export async function GET() {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://jeffistoress.com'

  const products = await queryMany(`
    SELECT p.*,
      json_build_object('id', c.id, 'name', c.name, 'slug', c.slug) AS categories,
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
    LEFT JOIN brands b ON p.brand_id = b.id
    WHERE p.is_active = true
    ORDER BY p.created_at DESC
  `)

  const items: string[] = []

  for (const product of products) {
    const primaryImage = product.product_images?.find((img: any) => img.is_primary) || product.product_images?.[0]
    const imageUrl = primaryImage?.image_url || ''
    const categoryName = product.categories?.name || ''
    const brandName = product.brands?.name || ''
    const description = (product.description || product.name).slice(0, 5000)
    const hasVariants = product.has_variants && product.product_variants?.length > 0

    if (hasVariants) {
      for (const variant of product.product_variants) {
        const sellingPrice = variant.sale_price ?? variant.price
        if (sellingPrice == null) continue
        const variantMrp = variant.mrp ? Number(variant.mrp) : (product.mrp ? Number(product.mrp) : null)
        const hasSalePrice = variantMrp && variantMrp > Number(sellingPrice)
        const variantMpn = variant.mpn || product.mpn || ''
        const variantGtin = variant.gtin || product.gtin || ''

        items.push(`    <item>
      <g:id>${escapeXml(variant.sku)}</g:id>
      <g:item_group_id>${escapeXml(product.sku)}</g:item_group_id>
      <title>${escapeXml(product.name)} - ${escapeXml(variant.variant_name)}</title>
      <description>${escapeXml(description)}</description>
      <link>${baseUrl}/products/${product.slug}?sku=${encodeURIComponent(variant.sku)}</link>
      <g:image_link>${escapeXml(imageUrl)}</g:image_link>
      <g:price>${Number(sellingPrice).toFixed(2)} INR</g:price>${hasSalePrice ? `
      <g:sale_price>${Number(sellingPrice).toFixed(2)} INR</g:sale_price>` : ''}
      <g:availability>${variant.stock_quantity > 0 ? 'in_stock' : 'out_of_stock'}</g:availability>
      <g:condition>new</g:condition>${brandName ? `
      <g:brand>${escapeXml(brandName)}</g:brand>` : ''}${variantMpn ? `
      <g:mpn>${escapeXml(variantMpn)}</g:mpn>` : ''}${variantGtin ? `
      <g:gtin>${escapeXml(variantGtin)}</g:gtin>` : ''}${categoryName ? `
      <g:product_type>${escapeXml(categoryName)}</g:product_type>` : ''}${product.weight ? `
      <g:shipping_weight>${product.weight} kg</g:shipping_weight>` : ''}
    </item>`)
      }
    } else {
      const sellingPrice = product.sale_price ?? product.base_price
      const productMrp = product.mrp ? Number(product.mrp) : null
      const hasSalePrice = productMrp && productMrp > Number(sellingPrice)

      items.push(`    <item>
      <g:id>${escapeXml(product.sku)}</g:id>
      <title>${escapeXml(product.name)}</title>
      <description>${escapeXml(description)}</description>
      <link>${baseUrl}/products/${product.slug}</link>
      <g:image_link>${escapeXml(imageUrl)}</g:image_link>
      <g:price>${Number(sellingPrice).toFixed(2)} INR</g:price>${hasSalePrice ? `
      <g:sale_price>${Number(sellingPrice).toFixed(2)} INR</g:sale_price>` : ''}
      <g:availability>${product.stock_quantity > 0 ? 'in_stock' : 'out_of_stock'}</g:availability>
      <g:condition>new</g:condition>${brandName ? `
      <g:brand>${escapeXml(brandName)}</g:brand>` : ''}${product.mpn ? `
      <g:mpn>${escapeXml(product.mpn)}</g:mpn>` : ''}${product.gtin ? `
      <g:gtin>${escapeXml(product.gtin)}</g:gtin>` : ''}${categoryName ? `
      <g:product_type>${escapeXml(categoryName)}</g:product_type>` : ''}${product.weight ? `
      <g:shipping_weight>${product.weight} kg</g:shipping_weight>` : ''}
    </item>`)
    }
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>Jeffi Stores</title>
    <link>${baseUrl}</link>
    <description>Industrial hardware, bolts, nuts, and tools</description>
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
