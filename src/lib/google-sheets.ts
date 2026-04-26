import { createSign } from 'crypto'
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
        variant.sku,
        `${product.name} - ${variant.variant_name}`,
        description,
        variant.stock_quantity > 0 ? 'in_stock' : 'out_of_stock',
        '',
        '',
        `${baseUrl}/products/${product.slug}?sku=${encodeURIComponent(variant.sku)}`,
        '',
        imageUrl,
        `${Number(variantMrp || sellingPrice).toFixed(2)} INR`,
        hasSalePrice ? `${Number(sellingPrice).toFixed(2)} INR` : '',
        '',
        (variant.mpn || product.mpn || variant.gtin || product.gtin || brandName) ? 'yes' : 'no',
        variant.gtin || product.gtin || '',
        variant.mpn || product.mpn || '',
        brandName,
        highlightsStr,
        detailsStr,
        additionalImages,
        'new',
        'no',
        '',
        variant.variant_name || '',
        '',
        '',
        '',
        material,
        '',
        '',
        '',
        'no',
        product.weight ? `${product.weight} kg` : '',
        '',
        '',
        '',
        '',
        product.sku,
        String(variant.stock_quantity || 0),
        googleProductCat,
        productType,
        cl0,
        cl1,
        cl2,
        cl3,
        cl4,
        product.weight ? `${product.weight} kg` : '',
      ])
    }
  } else {
    const sellingPrice = product.sale_price ?? product.base_price
    const productMrp = product.mrp ? Number(product.mrp) : null
    const hasSalePrice = productMrp && productMrp > Number(sellingPrice)
    const [cl0, cl1, cl2, cl3, cl4] = buildCustomLabels(product)

    rows.push([
      product.sku,
      product.name,
      description,
      product.stock_quantity > 0 ? 'in_stock' : 'out_of_stock',
      '',
      '',
      `${baseUrl}/products/${product.slug}`,
      '',
      imageUrl,
      `${Number(productMrp || sellingPrice).toFixed(2)} INR`,
      hasSalePrice ? `${Number(sellingPrice).toFixed(2)} INR` : '',
      '',
      (product.mpn || product.gtin || brandName) ? 'yes' : 'no',
      product.gtin || '',
      product.mpn || '',
      brandName,
      highlightsStr,
      detailsStr,
      additionalImages,
      'new',
      'no',
      '',
      product.size || '',
      '',
      '',
      '',
      material,
      '',
      '',
      '',
      'no',
      product.weight ? `${product.weight} kg` : '',
      '',
      '',
      '',
      '',
      '',
      String(product.stock_quantity || 0),
      googleProductCat,
      productType,
      cl0,
      cl1,
      cl2,
      cl3,
      cl4,
      product.weight ? `${product.weight} kg` : '',
    ])
  }

  return rows
}

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

export async function syncAllProductsToSheet(): Promise<number> {
  const token = await getAccessToken()
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://jeffistoress.com'
  const products = await fetchAllProducts()

  const allRows: string[][] = []
  for (const product of products) {
    allRows.push(...productToSheetRows(product, baseUrl))
  }

  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${SHEET_NAME}!AM1:AT1?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ range: `${SHEET_NAME}!AM1:AT1`, majorDimension: 'ROWS', values: [NEW_HEADERS] }),
    }
  )

  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${SHEET_NAME}!A2:AT?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        range: `${SHEET_NAME}!A2:AT`,
        majorDimension: 'ROWS',
        values: allRows.length > 0 ? allRows : [['']],
      }),
    }
  )

  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets.properties.gridProperties`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const meta = await metaRes.json()
  const totalRows = meta.sheets?.[0]?.properties?.gridProperties?.rowCount || 1000
  const dataEndRow = allRows.length + 1

  if (totalRows > dataEndRow + 1) {
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${SHEET_NAME}!A${dataEndRow + 1}:AT${totalRows}:clear`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` } }
    )
  }

  return allRows.length
}

export async function syncProductToSheet(productId: string): Promise<void> {
  try {
    const token = await getAccessToken()
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://jeffistoress.com'
    const product = await fetchProduct(productId)

    if (!product || !product.is_active) {
      await removeProductFromSheet(product?.sku || '', token)
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
        `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${SHEET_NAME}!A:AT:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
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
