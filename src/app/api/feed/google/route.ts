import { NextResponse } from 'next/server'
import { queryMany } from '@/lib/db'
import {
  getGoogleProductCategory,
  buildProductType,
  buildProductHighlights,
  buildProductDetails,
  buildCustomLabels,
} from '@/lib/google-merchant-helpers'

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
    WHERE p.is_active = true
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

    const googleProductCat = getGoogleProductCategory(product)
    const productType = buildProductType(product)
    const highlights = buildProductHighlights(product)
    const details = buildProductDetails(product)
    const [cl0, cl1, cl2, cl3, cl4] = buildCustomLabels(product)

    // Shared XML fragments
    const additionalImagesXml = additionalImages.map((url: string) =>
      `\n      <g:additional_image_link>${escapeXml(url)}</g:additional_image_link>`).join('')
    const googleCatXml = googleProductCat ? `\n      <g:google_product_category>${escapeXml(googleProductCat)}</g:google_product_category>` : ''
    const productTypeXml = productType ? `\n      <g:product_type>${escapeXml(productType)}</g:product_type>` : ''
    const highlightsXml = highlights.map(h => `\n      <g:product_highlight>${escapeXml(h)}</g:product_highlight>`).join('')
    const detailsXml = details.map(d =>
      `\n      <g:product_detail>\n        <g:section_name>${escapeXml(d.section)}</g:section_name>\n        <g:attribute_name>${escapeXml(d.attribute)}</g:attribute_name>\n        <g:attribute_value>${escapeXml(d.value)}</g:attribute_value>\n      </g:product_detail>`
    ).join('')
    const materialXml = product.material ? `\n      <g:material>${escapeXml(product.material)}</g:material>` : ''
    const customLabelsXml = [cl0, cl1, cl2, cl3, cl4].map((label, i) =>
      label ? `\n      <g:custom_label_${i}>${escapeXml(label)}</g:custom_label_${i}>` : ''
    ).join('')

    if (hasVariants) {
      for (const variant of product.product_variants) {
        const sellingPrice = variant.sale_price ?? variant.price
        if (sellingPrice == null) continue
        const variantMrp = variant.mrp ? Number(variant.mrp) : (product.mrp ? Number(product.mrp) : null)
        const hasSalePrice = variantMrp && variantMrp > Number(sellingPrice)
        const variantMpn = variant.mpn || product.mpn || ''
        const variantGtin = variant.gtin || product.gtin || ''
        const variantCl = buildCustomLabels(product, variant.stock_quantity)

        const variantCustomLabelsXml = [variantCl[0], variantCl[1], variantCl[2], variantCl[3], variantCl[4]].map((label, i) =>
          label ? `\n      <g:custom_label_${i}>${escapeXml(label)}</g:custom_label_${i}>` : ''
        ).join('')

        items.push(`    <item>
      <g:id>${escapeXml(variant.sku)}</g:id>
      <g:item_group_id>${escapeXml(product.sku)}</g:item_group_id>
      <title>${escapeXml(product.name)} - ${escapeXml(variant.variant_name)}</title>
      <description>${escapeXml(description)}</description>
      <link>${baseUrl}/products/${product.slug}?sku=${encodeURIComponent(variant.sku)}</link>
      <g:image_link>${escapeXml(imageUrl)}</g:image_link>${additionalImagesXml}
      <g:price>${Number(hasSalePrice ? variantMrp : sellingPrice).toFixed(2)} INR</g:price>${hasSalePrice ? `
      <g:sale_price>${Number(sellingPrice).toFixed(2)} INR</g:sale_price>` : ''}
      <g:availability>${variant.stock_quantity > 0 ? 'in_stock' : 'out_of_stock'}</g:availability>
      <g:condition>new</g:condition>
      <g:identifier_exists>${(variantMpn || variantGtin || brandName) ? 'true' : 'false'}</g:identifier_exists>${brandName ? `
      <g:brand>${escapeXml(brandName)}</g:brand>` : ''}${variantMpn ? `
      <g:mpn>${escapeXml(variantMpn)}</g:mpn>` : ''}${variantGtin ? `
      <g:gtin>${escapeXml(variantGtin)}</g:gtin>` : ''}${googleCatXml}${productTypeXml}${highlightsXml}${detailsXml}${materialXml}
      <g:size>${escapeXml(variant.variant_name)}</g:size>${product.weight ? `
      <g:shipping_weight>${product.weight} kg</g:shipping_weight>` : ''}
      <g:max_handling_time>3</g:max_handling_time>${variantCustomLabelsXml}
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
      <g:image_link>${escapeXml(imageUrl)}</g:image_link>${additionalImagesXml}
      <g:price>${Number(hasSalePrice ? productMrp : sellingPrice).toFixed(2)} INR</g:price>${hasSalePrice ? `
      <g:sale_price>${Number(sellingPrice).toFixed(2)} INR</g:sale_price>` : ''}
      <g:availability>${product.stock_quantity > 0 ? 'in_stock' : 'out_of_stock'}</g:availability>
      <g:condition>new</g:condition>
      <g:identifier_exists>${(product.mpn || product.gtin || brandName) ? 'true' : 'false'}</g:identifier_exists>${brandName ? `
      <g:brand>${escapeXml(brandName)}</g:brand>` : ''}${product.mpn ? `
      <g:mpn>${escapeXml(product.mpn)}</g:mpn>` : ''}${product.gtin ? `
      <g:gtin>${escapeXml(product.gtin)}</g:gtin>` : ''}${googleCatXml}${productTypeXml}${highlightsXml}${detailsXml}${materialXml}${product.size ? `
      <g:size>${escapeXml(product.size)}</g:size>` : ''}${product.weight ? `
      <g:shipping_weight>${product.weight} kg</g:shipping_weight>` : ''}
      <g:max_handling_time>3</g:max_handling_time>${customLabelsXml}
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
