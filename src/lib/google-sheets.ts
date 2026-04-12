import { SignJWT } from 'jose'
import { queryMany } from './db'
import fs from 'fs'
import path from 'path'
import {
  getGoogleProductCategory,
  buildProductType,
  buildProductHighlights,
  buildProductDetails,
  buildCustomLabels,
} from './google-merchant-helpers'

const SPREADSHEET_ID = '1UYRNtdtvyEl2PF5yAXwtmsKqAKQ-Onqmu9PkR2T2PyU'
const SHEET_NAME = 'Sheet1'
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets'

const NEW_HEADERS = [
  'google_product_category', 'product_type',
  'custom_label_0', 'custom_label_1', 'custom_label_2', 'custom_label_3', 'custom_label_4',
  'shipping_weight',
]

interface ServiceAccountCreds {
  client_email: string
  private_key: string
}

let cachedToken: { token: string; expiresAt: number } | null = null

function loadCredentials(): ServiceAccountCreds {
  const credPath = path.join(process.cwd(), 'jeffi-stores-76e9ecaecdd6.json')
  const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'))
  return { client_email: creds.client_email, private_key: creds.private_key }
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60000) {
    return cachedToken.token
  }

  const creds = loadCredentials()
  const privateKey = await (await import('jose')).importPKCS8(creds.private_key, 'RS256')
  const now = Math.floor(Date.now() / 1000)

  const jwt = await new SignJWT({
    iss: creds.client_email,
    scope: SCOPES,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .sign(privateKey)

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  })

  const data = await res.json()
  if (!data.access_token) {
    throw new Error('Failed to get Google access token: ' + JSON.stringify(data))
  }

  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
  return data.access_token
}

/**
 * Map a product (with related data) to a Google Merchant Sheet row.
 * Each variant becomes its own row. Non-variant products get one row.
 * 46 columns: A (id) through AT (shipping_weight).
 */
function productToSheetRows(product: any, baseUrl: string): string[][] {
  const primaryImage = product.product_images?.find((img: any) => img.is_primary) || product.product_images?.[0]
  const imageUrl = primaryImage?.image_url || ''
  const additionalImages = (product.product_images || [])
    .filter((img: any) => img.id !== primaryImage?.id)
    .map((img: any) => img.image_url)
    .join(',')
  const brandName = product.brands?.name || ''
  const description = (product.description || product.name || '').slice(0, 5000)
  const material = product.material || ''
  const hasVariants = product.has_variants && product.product_variants?.length > 0

  const googleProductCat = getGoogleProductCategory(product)
  const productType = buildProductType(product)
  const highlightsStr = buildProductHighlights(product).join(', ')
  const detailsStr = buildProductDetails(product)
    .map(d => `${d.section}:${d.attribute}:${d.value}`)
    .join(', ')

  const rows: string[][] = []

  if (hasVariants) {
    for (const variant of product.product_variants) {
      const sellingPrice = variant.sale_price ?? variant.price
      if (sellingPrice == null) continue
      const variantMrp = variant.mrp ? Number(variant.mrp) : (product.mrp ? Number(product.mrp) : null)
      const hasSalePrice = variantMrp && variantMrp > Number(sellingPrice)
      const [cl0, cl1, cl2, cl3, cl4] = buildCustomLabels(product, variant.stock_quantity)

      rows.push([
        variant.sku,                                                          // A: id
        `${product.name} - ${variant.variant_name}`,                          // B: title
        description,                                                          // C: description
        variant.stock_quantity > 0 ? 'in_stock' : 'out_of_stock',            // D: availability
        '',                                                                   // E: availability date
        '',                                                                   // F: expiration date
        `${baseUrl}/products/${product.slug}?sku=${encodeURIComponent(variant.sku)}`, // G: link
        '',                                                                   // H: mobile link
        imageUrl,                                                             // I: image link
        `${Number(variantMrp || sellingPrice).toFixed(2)} INR`,              // J: price (MRP or selling)
        hasSalePrice ? `${Number(sellingPrice).toFixed(2)} INR` : '',        // K: sale price
        '',                                                                   // L: sale price effective date
        (variant.mpn || product.mpn || variant.gtin || product.gtin || brandName) ? 'yes' : 'no', // M: identifier exists
        variant.gtin || product.gtin || '',                                   // N: gtin
        variant.mpn || product.mpn || '',                                     // O: mpn
        brandName,                                                            // P: brand
        highlightsStr,                                                        // Q: product highlight
        detailsStr,                                                           // R: product detail
        additionalImages,                                                     // S: additional image link
        'new',                                                                // T: condition
        'no',                                                                 // U: adult
        '',                                                                   // V: color
        variant.variant_name || '',                                           // W: size
        '',                                                                   // X: size type
        '',                                                                   // Y: size system
        '',                                                                   // Z: gender
        material,                                                             // AA: material
        '',                                                                   // AB: pattern
        '',                                                                   // AC: age group
        '',                                                                   // AD: multipack
        'no',                                                                 // AE: is bundle
        product.weight ? `${product.weight} kg` : '',                         // AF: unit pricing measure
        '',                                                                   // AG: unit pricing base measure
        '',                                                                   // AH: energy efficiency class
        '',                                                                   // AI: min energy efficiency class
        '',                                                                   // AJ: max energy efficiency class
        product.sku,                                                          // AK: item group id
        String(variant.stock_quantity || 0),                                  // AL: sell on google quantity
        // --- New columns (AM–AT) ---
        googleProductCat,                                                     // AM: google product category
        productType,                                                          // AN: product type
        cl0,                                                                  // AO: custom label 0
        cl1,                                                                  // AP: custom label 1
        cl2,                                                                  // AQ: custom label 2
        cl3,                                                                  // AR: custom label 3
        cl4,                                                                  // AS: custom label 4
        product.weight ? `${product.weight} kg` : '',                         // AT: shipping weight
      ])
    }
  } else {
    const sellingPrice = product.sale_price ?? product.base_price
    const productMrp = product.mrp ? Number(product.mrp) : null
    const hasSalePrice = productMrp && productMrp > Number(sellingPrice)
    const [cl0, cl1, cl2, cl3, cl4] = buildCustomLabels(product)

    rows.push([
      product.sku,                                                            // A: id
      product.name,                                                           // B: title
      description,                                                            // C: description
      product.stock_quantity > 0 ? 'in_stock' : 'out_of_stock',              // D: availability
      '',                                                                     // E: availability date
      '',                                                                     // F: expiration date
      `${baseUrl}/products/${product.slug}`,                                  // G: link
      '',                                                                     // H: mobile link
      imageUrl,                                                               // I: image link
      `${Number(productMrp || sellingPrice).toFixed(2)} INR`,                // J: price
      hasSalePrice ? `${Number(sellingPrice).toFixed(2)} INR` : '',          // K: sale price
      '',                                                                     // L: sale price effective date
      (product.mpn || product.gtin || brandName) ? 'yes' : 'no',            // M: identifier exists
      product.gtin || '',                                                     // N: gtin
      product.mpn || '',                                                      // O: mpn
      brandName,                                                              // P: brand
      highlightsStr,                                                          // Q: product highlight
      detailsStr,                                                             // R: product detail
      additionalImages,                                                       // S: additional image link
      'new',                                                                  // T: condition
      'no',                                                                   // U: adult
      '',                                                                     // V: color
      product.size || '',                                                     // W: size
      '',                                                                     // X: size type
      '',                                                                     // Y: size system
      '',                                                                     // Z: gender
      material,                                                               // AA: material
      '',                                                                     // AB: pattern
      '',                                                                     // AC: age group
      '',                                                                     // AD: multipack
      'no',                                                                   // AE: is bundle
      product.weight ? `${product.weight} kg` : '',                           // AF: unit pricing measure
      '',                                                                     // AG: unit pricing base measure
      '',                                                                     // AH: energy efficiency class
      '',                                                                     // AI: min energy efficiency class
      '',                                                                     // AJ: max energy efficiency class
      '',                                                                     // AK: item group id
      String(product.stock_quantity || 0),                                    // AL: sell on google quantity
      // --- New columns (AM–AT) ---
      googleProductCat,                                                       // AM: google product category
      productType,                                                            // AN: product type
      cl0,                                                                    // AO: custom label 0
      cl1,                                                                    // AP: custom label 1
      cl2,                                                                    // AQ: custom label 2
      cl3,                                                                    // AR: custom label 3
      cl4,                                                                    // AS: custom label 4
      product.weight ? `${product.weight} kg` : '',                           // AT: shipping weight
    ])
  }

  return rows
}

/**
 * Fetch all active products with related data (same query as the XML feed).
 */
async function fetchAllProducts() {
  return queryMany(`
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
}

/**
 * Fetch a single product with related data.
 */
async function fetchProduct(productId: string) {
  const { queryOne } = await import('./db')
  return queryOne(`
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
    WHERE p.id = $1
  `, [productId])
}

/**
 * Full sync: clear sheet (except row 1 header) and write all products.
 */
export async function syncAllProductsToSheet(): Promise<number> {
  const token = await getAccessToken()
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://jeffistoress.com'
  const products = await fetchAllProducts()

  // Build all rows
  const allRows: string[][] = []
  for (const product of products) {
    allRows.push(...productToSheetRows(product, baseUrl))
  }

  // Write new column headers (AM1:AT1) for the 8 additional columns
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${SHEET_NAME}!AM1:AT1?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        range: `${SHEET_NAME}!AM1:AT1`,
        majorDimension: 'ROWS',
        values: [NEW_HEADERS],
      }),
    }
  )

  // Clear everything below row 1 (keep header)
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${SHEET_NAME}!A2:AT?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        range: `${SHEET_NAME}!A2:AT`,
        majorDimension: 'ROWS',
        values: allRows.length > 0 ? allRows : [['']],
      }),
    }
  )

  // Clear any leftover rows from previous data if new data is shorter
  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets.properties.gridProperties`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const meta = await metaRes.json()
  const totalRows = meta.sheets?.[0]?.properties?.gridProperties?.rowCount || 1000
  const dataEndRow = allRows.length + 1 // +1 for header

  if (totalRows > dataEndRow + 1) {
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${SHEET_NAME}!A${dataEndRow + 1}:AT${totalRows}:clear`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }
    )
  }

  console.log(`Google Sheets: synced ${allRows.length} rows (${products.length} products)`)
  return allRows.length
}

/**
 * Sync a single product to the sheet.
 * Finds existing rows by SKU (column A) and replaces them, or appends if new.
 */
export async function syncProductToSheet(productId: string): Promise<void> {
  try {
    const token = await getAccessToken()
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://jeffistoress.com'
    const product = await fetchProduct(productId)

    if (!product || !product.is_active) {
      // Product deactivated — remove from sheet
      await removeProductFromSheet(product?.sku || '', token)
      return
    }

    const newRows = productToSheetRows(product, baseUrl)

    // Get all current SKUs from column A to find existing rows
    const existingRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${SHEET_NAME}!A:A`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const existingData = await existingRes.json()
    const existingSkus: string[] = (existingData.values || []).map((r: string[]) => r[0] || '')

    // Collect all SKUs belonging to this product (product SKU + variant SKUs)
    const productSkus = new Set<string>()
    productSkus.add(product.sku)
    if (product.product_variants) {
      for (const v of product.product_variants) {
        productSkus.add(v.sku)
      }
    }

    // Find row indices to delete (0-based, but sheet is 1-based)
    const rowsToDelete: number[] = []
    for (let i = 1; i < existingSkus.length; i++) { // skip header
      if (productSkus.has(existingSkus[i])) {
        rowsToDelete.push(i)
      }
    }

    // Delete old rows in reverse order (so indices don't shift)
    if (rowsToDelete.length > 0) {
      const requests = rowsToDelete.reverse().map(rowIdx => ({
        deleteDimension: {
          range: {
            sheetId: 455679373,
            dimension: 'ROWS',
            startIndex: rowIdx,
            endIndex: rowIdx + 1,
          },
        },
      }))

      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ requests }),
        }
      )
    }

    // Append new rows
    if (newRows.length > 0) {
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${SHEET_NAME}!A:AT:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            majorDimension: 'ROWS',
            values: newRows,
          }),
        }
      )
    }

    console.log(`Google Sheets: synced product ${product.sku} (${newRows.length} rows)`)
  } catch (error) {
    console.error('Google Sheets sync error:', error)
    // Don't throw — sheet sync should not block product operations
  }
}

async function removeProductFromSheet(sku: string, token: string) {
  if (!sku) return

  const existingRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${SHEET_NAME}!A:A`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const existingData = await existingRes.json()
  const existingSkus: string[] = (existingData.values || []).map((r: string[]) => r[0] || '')

  // Find rows matching this SKU or its variants (variants start with the product SKU)
  const rowsToDelete: number[] = []
  for (let i = 1; i < existingSkus.length; i++) {
    if (existingSkus[i] === sku || existingSkus[i].startsWith(sku + '-')) {
      rowsToDelete.push(i)
    }
  }

  if (rowsToDelete.length > 0) {
    const requests = rowsToDelete.reverse().map(rowIdx => ({
      deleteDimension: {
        range: {
          sheetId: 455679373,
          dimension: 'ROWS',
          startIndex: rowIdx,
          endIndex: rowIdx + 1,
        },
      },
    }))

    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ requests }),
      }
    )
  }
}
