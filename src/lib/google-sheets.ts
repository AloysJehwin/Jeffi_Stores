import { createSign } from 'crypto'
import { queryMany } from './db'
import { loadGoogleServiceAccount } from './google-credentials'
import {
  buildProductHighlights,
  buildProductDetails,
} from './google-merchant-helpers'

// Spreadsheet ID is environment-driven: local dev points GOOGLE_SHEET_ID at a test
// sheet, production falls back to the real Merchant feed sheet.
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID || '1UYRNtdtvyEl2PF5yAXwtmsKqAKQ-Onqmu9PkR2T2PyU'
const SHEET_NAME = 'Sheet1'
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets'

// The exact 40-column Google Merchant feed template (order matters; column 31
// "is bundle" is the only header with a space, matching the template verbatim).
// 40 columns => spreadsheet range A:AN.
const HEADERS = [
  'id', 'title', 'description', 'availability', 'availability_date', 'expiration_date',
  'link', 'mobile_link', 'image_link', 'price', 'sale_price', 'sale_price_effective_date',
  'identifier_exists', 'gtin', 'mpn', 'brand', 'product_highlight', 'product_detail',
  'additional_image_link', 'condition', 'adult', 'color', 'size', 'size_type', 'size_system',
  'gender', 'material', 'pattern', 'age_group', 'multipack', 'is bundle', 'unit_pricing_measure',
  'unit_pricing_base_measure', 'energy_efficiency_class', 'min_energy_efficiency_class',
  'max_energy_efficiency', 'item_group_id', 'video_link', 'virtual_model_link', 'cost_of_goods_sold',
]
const LAST_COL = 'AN' // 40th column

interface ServiceAccountCreds {
  client_email: string
  private_key: string
}

let cachedToken: { token: string; expiresAt: number } | null = null

function loadCredentials(): ServiceAccountCreds {
  return loadGoogleServiceAccount()
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60000) {
    return cachedToken.token
  }

  const creds = loadCredentials()
  const now = Math.floor(Date.now() / 1000)

  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss: creds.client_email,
    scope: SCOPES,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })).toString('base64url')

  const signer = createSign('RSA-SHA256')
  signer.update(header + '.' + payload)
  const sig = signer.sign(creds.private_key).toString('base64url')
  const jwt = header + '.' + payload + '.' + sig

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
  const productActive = product.is_active !== false

  const highlightsStr = buildProductHighlights(product).join(', ')
  const detailsStr = buildProductDetails(product)
    .map(d => `${d.section}:${d.attribute}:${d.value}`)
    .join(', ')

  // cost_of_goods_sold: from variant/product cost_price, only when > 0.
  const cogs = (cost: any): string => {
    const n = Number(cost)
    return n > 0 ? `${n.toFixed(2)} INR` : ''
  }

  const rows: string[][] = []

  if (hasVariants) {
    for (const variant of product.product_variants) {
      const sellingPrice = variant.price
      if (sellingPrice == null) continue
      const variantMrp = variant.mrp ? Number(variant.mrp) : (product.mrp ? Number(product.mrp) : null)
      const hasSalePrice = variantMrp && variantMrp > Number(sellingPrice)
      // Inactive product => force out_of_stock regardless of stock_status.
      const availability = !productActive
        ? 'out_of_stock'
        : (variant.stock_status !== 'Out of Stock' ? 'in_stock' : 'out_of_stock')

      rows.push([
        variant.sku,                                                         // 1  id
        `${product.name} - ${variant.variant_name}`,                         // 2  title
        description,                                                         // 3  description
        availability,                                                        // 4  availability
        '',                                                                  // 5  availability_date
        '',                                                                  // 6  expiration_date
        `${baseUrl}/products/${product.slug}?sku=${encodeURIComponent(variant.sku)}`, // 7 link
        '',                                                                  // 8  mobile_link
        imageUrl,                                                            // 9  image_link
        `${Number(variantMrp || sellingPrice).toFixed(2)} INR`,              // 10 price
        hasSalePrice ? `${Number(sellingPrice).toFixed(2)} INR` : '',        // 11 sale_price
        '',                                                                  // 12 sale_price_effective_date
        (variant.mpn || product.mpn || variant.gtin || product.gtin || brandName) ? 'yes' : 'no', // 13 identifier_exists
        variant.gtin || product.gtin || '',                                  // 14 gtin
        variant.mpn || product.mpn || '',                                    // 15 mpn
        brandName,                                                           // 16 brand
        highlightsStr,                                                       // 17 product_highlight
        detailsStr,                                                          // 18 product_detail
        additionalImages,                                                    // 19 additional_image_link
        'new',                                                               // 20 condition
        'no',                                                                // 21 adult
        '',                                                                  // 22 color
        variant.variant_name || '',                                          // 23 size
        '',                                                                  // 24 size_type
        '',                                                                  // 25 size_system
        '',                                                                  // 26 gender
        material,                                                            // 27 material
        '',                                                                  // 28 pattern
        '',                                                                  // 29 age_group
        '',                                                                  // 30 multipack
        'no',                                                                // 31 is bundle
        '',                                                                  // 32 unit_pricing_measure
        '',                                                                  // 33 unit_pricing_base_measure
        '',                                                                  // 34 energy_efficiency_class
        '',                                                                  // 35 min_energy_efficiency_class
        '',                                                                  // 36 max_energy_efficiency
        product.sku,                                                         // 37 item_group_id
        '',                                                                  // 38 video_link
        '',                                                                  // 39 virtual_model_link
        cogs(variant.cost_price ?? product.cost_price),                      // 40 cost_of_goods_sold
      ])
    }
  } else {
    const sellingPrice = product.base_price
    const productMrp = product.mrp ? Number(product.mrp) : null
    const hasSalePrice = productMrp && productMrp > Number(sellingPrice)
    const availability = !productActive
      ? 'out_of_stock'
      : (product.stock_status !== 'Out of Stock' ? 'in_stock' : 'out_of_stock')

    rows.push([
      product.sku,                                                           // 1  id
      product.name,                                                          // 2  title
      description,                                                           // 3  description
      availability,                                                          // 4  availability
      '',                                                                    // 5  availability_date
      '',                                                                    // 6  expiration_date
      `${baseUrl}/products/${product.slug}`,                                 // 7  link
      '',                                                                    // 8  mobile_link
      imageUrl,                                                              // 9  image_link
      `${Number(productMrp || sellingPrice).toFixed(2)} INR`,                // 10 price
      hasSalePrice ? `${Number(sellingPrice).toFixed(2)} INR` : '',          // 11 sale_price
      '',                                                                    // 12 sale_price_effective_date
      (product.mpn || product.gtin || brandName) ? 'yes' : 'no',             // 13 identifier_exists
      product.gtin || '',                                                    // 14 gtin
      product.mpn || '',                                                     // 15 mpn
      brandName,                                                             // 16 brand
      highlightsStr,                                                         // 17 product_highlight
      detailsStr,                                                            // 18 product_detail
      additionalImages,                                                      // 19 additional_image_link
      'new',                                                                 // 20 condition
      'no',                                                                  // 21 adult
      '',                                                                    // 22 color
      product.size || '',                                                    // 23 size
      '',                                                                    // 24 size_type
      '',                                                                    // 25 size_system
      '',                                                                    // 26 gender
      material,                                                              // 27 material
      '',                                                                    // 28 pattern
      '',                                                                    // 29 age_group
      '',                                                                    // 30 multipack
      'no',                                                                  // 31 is bundle
      '',                                                                    // 32 unit_pricing_measure
      '',                                                                    // 33 unit_pricing_base_measure
      '',                                                                    // 34 energy_efficiency_class
      '',                                                                    // 35 min_energy_efficiency_class
      '',                                                                    // 36 max_energy_efficiency
      '',                                                                    // 37 item_group_id
      '',                                                                    // 38 video_link
      '',                                                                    // 39 virtual_model_link
      cogs(product.cost_price),                                              // 40 cost_of_goods_sold
    ])
  }

  return rows
}

async function fetchAllProducts(limit?: number) {
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
    WHERE p.is_draft = false
    ORDER BY p.created_at DESC
    ${limit ? `LIMIT ${limit}` : ''}
  `)
}

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

export async function syncAllProductsToSheet(testLimit?: number): Promise<{ inserted: number; updated: number; skipped: number }> {
  const token = await getAccessToken()
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://jeffistoress.com'
  const products = await fetchAllProducts(testLimit)

  const existingRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${SHEET_NAME}!A:${LAST_COL}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const existingData = await existingRes.json()
  const existingRows: string[][] = existingData.values || []

  const skuToRowIndex = new Map<string, number>()
  const skuToRowData = new Map<string, string[]>()
  for (let i = 1; i < existingRows.length; i++) {
    const sku = existingRows[i]?.[0]
    if (sku) {
      skuToRowIndex.set(sku, i + 1)
      skuToRowData.set(sku, existingRows[i])
    }
  }

  const updateBatch: Array<{ range: string; values: string[][] }> = []
  const toAppend: string[][] = []
  let skipped = 0

  for (const product of products) {
    const newRows = productToSheetRows(product, baseUrl)
    for (const newRow of newRows) {
      const sku = newRow[0]
      if (!sku) continue

      if (skuToRowIndex.has(sku)) {
        const existing = skuToRowData.get(sku)!
        const changed = newRow.some((cell, idx) => (existing[idx] ?? '') !== cell)
        if (changed) {
          const rowNum = skuToRowIndex.get(sku)!
          updateBatch.push({ range: `${SHEET_NAME}!A${rowNum}:${LAST_COL}${rowNum}`, values: [newRow] })
        } else {
          skipped++
        }
      } else {
        toAppend.push(newRow)
      }
    }
  }

  if (updateBatch.length > 0) {
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values:batchUpdate`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ valueInputOption: 'RAW', data: updateBatch }),
      }
    )
  }

  if (toAppend.length > 0) {
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${SHEET_NAME}!A:${LAST_COL}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ majorDimension: 'ROWS', values: toAppend }),
      }
    )
  }

  if (existingRows.length === 0) {
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${SHEET_NAME}!A1:${LAST_COL}1?valueInputOption=RAW`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ range: `${SHEET_NAME}!A1:${LAST_COL}1`, majorDimension: 'ROWS', values: [HEADERS] }),
      }
    )
  }

  return { inserted: toAppend.length, updated: updateBatch.length, skipped }
}

export async function syncProductToSheet(productId: string): Promise<void> {
  try {
    const token = await getAccessToken()
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://jeffistoress.com'
    const product = await fetchProduct(productId)

    // Inactive products are kept in the feed as out_of_stock (handled by productToSheetRows).
    // Only remove the row when the product no longer exists.
    if (!product) {
      return
    }

    const newRows = productToSheetRows(product, baseUrl)

    const existingRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${SHEET_NAME}!A:A`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const existingData = await existingRes.json()
    const existingSkus: string[] = (existingData.values || []).map((r: string[]) => r[0] || '')

    const productSkus = new Set<string>()
    productSkus.add(product.sku)
    if (product.product_variants) {
      for (const v of product.product_variants) productSkus.add(v.sku)
    }

    const rowsToDelete: number[] = []
    for (let i = 1; i < existingSkus.length; i++) {
      if (productSkus.has(existingSkus[i])) rowsToDelete.push(i)
    }

    if (rowsToDelete.length > 0) {
      const requests = rowsToDelete.reverse().map(rowIdx => ({
        deleteDimension: {
          range: { sheetId: 455679373, dimension: 'ROWS', startIndex: rowIdx, endIndex: rowIdx + 1 },
        },
      }))
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ requests }),
        }
      )
    }

    if (newRows.length > 0) {
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${SHEET_NAME}!A:${LAST_COL}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ majorDimension: 'ROWS', values: newRows }),
        }
      )
    }
  } catch (err: any) {
    throw err
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

  const rowsToDelete: number[] = []
  for (let i = 1; i < existingSkus.length; i++) {
    if (existingSkus[i] === sku || existingSkus[i].startsWith(sku + '-')) rowsToDelete.push(i)
  }

  if (rowsToDelete.length > 0) {
    const requests = rowsToDelete.reverse().map(rowIdx => ({
      deleteDimension: {
        range: { sheetId: 455679373, dimension: 'ROWS', startIndex: rowIdx, endIndex: rowIdx + 1 },
      },
    }))
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests }),
      }
    )
  }
}

// Read a value matrix from any spreadsheet with a caller-supplied OAuth access token — the
// tenant-scoped counterpart to the write helpers above, which use the platform service account.
// Used by the Data Source Google-sheet sync, which resolves the tenant's own token first.
export async function readSheetValues(
  spreadsheetId: string,
  range: string,
  accessToken: string,
): Promise<string[][]> {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const reason = data?.error?.message || `sheets read failed (${res.status})`
    throw new Error(reason)
  }
  return (data?.values as string[][]) || []
}

// Create a native Google Sheet in the caller's own Drive from a freshly-built .xlsx buffer, via a
// Drive API multipart upload that converts to google-apps.spreadsheet. Uses a tenant-scoped OAuth
// access token — the file is one this app creates, so it is always reachable under the drive.file
// scope (unlike copying a shared master, which 404s for any account that didn't create it). Returns
// the new spreadsheet id. Used by the Data Source "Create sheet from template" flow.
export async function createSheetFromWorkbook(
  title: string,
  xlsx: Buffer,
  accessToken: string,
): Promise<string> {
  const boundary = 'jeffi-ds-' + xlsx.length.toString(36)
  const metadata = { name: title, mimeType: 'application/vnd.google-apps.spreadsheet' }
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`,
    ),
    xlsx,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: new Uint8Array(body),
    },
  )
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.id) {
    const reason = data?.error?.message || `drive create failed (${res.status})`
    throw new Error(reason)
  }
  return String(data.id)
}

// Tab titles of a spreadsheet, in tab order. Needs only the spreadsheets.readonly scope.
export async function listSheetTitles(spreadsheetId: string, accessToken: string): Promise<string[]> {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error?.message || `sheets metadata failed (${res.status})`)
  const sheets = (data?.sheets as Array<{ properties?: { title?: string } }>) || []
  return sheets.map(s => String(s.properties?.title || '')).filter(Boolean)
}

// Several ranges in one round trip; the result is aligned to `ranges` (an unreadable range yields []).
export async function readSheetValuesBatch(spreadsheetId: string, ranges: string[], accessToken: string): Promise<string[][][]> {
  if (ranges.length === 0) return []
  const qs = ranges.map(r => `ranges=${encodeURIComponent(r)}`).join('&')
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchGet?${qs}&majorDimension=ROWS`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error?.message || `sheets batch read failed (${res.status})`)
  const vrs = (data?.valueRanges as Array<{ values?: string[][] }>) || []
  return ranges.map((_, i) => vrs[i]?.values || [])
}

// A1 range covering a whole tab, with the title quoted for the Sheets API.
export function wholeSheetRange(title: string): string {
  return `'${title.replace(/'/g, "''")}'!A:ZZ`
}
