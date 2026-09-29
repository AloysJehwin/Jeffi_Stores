import path from 'path'
import type { Policy, Section } from '@/lib/legals/policies'
import { getStoreIdentity } from '@/lib/site-controls'

const PDFDocument = eval('require')('pdfkit')

const PAGE_W = 595.28
const PAGE_H = 841.89
const ML = 50
const MR = 50
const CW = PAGE_W - ML - MR

const COLOR_DARK = '#1a3a4a'
const COLOR_BODY = '#222222'
const COLOR_MUTED = '#666666'
const COLOR_RULE = '#dddddd'
const COLOR_ACCENT = '#7cb900'

const STORE_ADDR = 'SANJAY GANTHI CHOWK, STATION ROAD, RAIPUR, CHHATTISGARH-490092'

interface StoreHeading { name: string; phone: string; email: string; web: string }

function drawHeader(doc: any, store: StoreHeading, logo?: string | Buffer) {
  doc.rect(0, 0, PAGE_W, 80).fillColor(COLOR_DARK).fill()
  const logoSrc = logo ?? path.join(process.cwd(), 'public', 'images', 'store-logo.png')
  try {
    doc.image(logoSrc, ML, 14, { width: 52, height: 52 })
  } catch {}
  doc.font('Helvetica-Bold').fontSize(20).fillColor('#ffffff')
  doc.text(store.name.toUpperCase(), ML + 64, 22, { lineBreak: false })
  doc.font('Helvetica').fontSize(8).fillColor('#cfe1c5')
  doc.text(STORE_ADDR, ML + 64, 46, { width: CW - 64, lineBreak: false })
  doc.text([store.phone, store.email, store.web].filter(Boolean).join('  |  '), ML + 64, 58, { width: CW - 64, lineBreak: false })
}

function drawFooter(doc: any, store: StoreHeading, pageNum: number, totalPages: number) {
  const y = PAGE_H - 36
  doc.moveTo(ML, y).lineTo(PAGE_W - MR, y).lineWidth(0.5).strokeColor(COLOR_RULE).stroke()
  doc.font('Helvetica').fontSize(8).fillColor(COLOR_MUTED)
  doc.text(`© ${new Date().getFullYear()} ${store.name} · ${store.web}`, ML, y + 8, { lineBreak: false })
  doc.text(`Page ${pageNum} of ${totalPages}`, PAGE_W - MR - 80, y + 8, { width: 80, align: 'right', lineBreak: false })
}

function drawSeal(doc: any, seal?: string | Buffer) {
  const sealSrc = seal ?? path.join(process.cwd(), 'public', 'images', 'jeffi-seal.png')
  const SEAL_SIZE = 110
  const x = PAGE_W - MR - SEAL_SIZE
  const y = PAGE_H - 36 - SEAL_SIZE - 20
  try {
    doc.opacity(0.85)
    doc.image(sealSrc, x, y, { width: SEAL_SIZE, height: SEAL_SIZE })
    doc.opacity(1)
  } catch {}
  // Date inside seal
  const cx = x + SEAL_SIZE / 2
  const cy = y + SEAL_SIZE / 2
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#5b21b6')
  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  doc.text(today, cx - 30, cy - 4, { width: 60, align: 'center', lineBreak: false })
}

function ensureRoom(doc: any, neededHeight: number, currentY: number, drawHeaderFn: () => void): number {
  const maxY = PAGE_H - 60 // leave room for footer + seal
  if (currentY + neededHeight > maxY) {
    doc.addPage()
    drawHeaderFn()
    return 100
  }
  return currentY
}

function renderSection(doc: any, section: Section, startY: number, drawHeaderFn: () => void): number {
  let y = startY
  y = ensureRoom(doc, 28, y, drawHeaderFn)

  doc.font('Helvetica-Bold').fontSize(12).fillColor(COLOR_DARK)
  doc.text(section.heading, ML, y, { width: CW })
  y = doc.y + 6

  doc.font('Helvetica').fontSize(10).fillColor(COLOR_BODY)

  if (Array.isArray(section.body)) {
    for (const item of section.body) {
      const lineHeight = doc.heightOfString(item, { width: CW - 18, lineGap: 1.5 })
      y = ensureRoom(doc, lineHeight + 6, y, drawHeaderFn)
      doc.circle(ML + 4, y + 5, 1.5).fillColor(COLOR_ACCENT).fill()
      doc.fillColor(COLOR_BODY)
      doc.text(item, ML + 14, y, { width: CW - 18, lineGap: 1.5, align: 'justify' })
      y = doc.y + 4
    }
  } else {
    const lineHeight = doc.heightOfString(section.body, { width: CW, lineGap: 1.5 })
    y = ensureRoom(doc, lineHeight + 4, y, drawHeaderFn)
    doc.text(section.body, ML, y, { width: CW, lineGap: 1.5, align: 'justify' })
    y = doc.y + 6
  }

  return y + 6
}

export async function generatePolicyPDF(policy: Policy, branding?: { logo?: string | Buffer; seal?: string | Buffer }): Promise<Buffer> {
  const identity = await getStoreIdentity()
  const store: StoreHeading = {
    name: identity.name,
    phone: identity.phone,
    email: identity.email,
    web: identity.web,
  }
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false, bufferPages: true })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const drawHeaderFn = () => drawHeader(doc, store, branding?.logo)

    doc.addPage()
    drawHeaderFn()

    let y = 100
    doc.font('Helvetica-Bold').fontSize(20).fillColor(COLOR_DARK)
    doc.text(policy.title, ML, y, { width: CW })
    y = doc.y + 6

    doc.font('Helvetica').fontSize(10).fillColor(COLOR_MUTED)
    doc.text(policy.description, ML, y, { width: CW, lineGap: 1 })
    y = doc.y + 4

    doc.fontSize(8.5).fillColor(COLOR_MUTED)
    doc.text(`Last updated: ${policy.lastUpdated}`, ML, y, { lineBreak: false })
    y += 16

    doc.moveTo(ML, y).lineTo(PAGE_W - MR, y).lineWidth(0.5).strokeColor(COLOR_RULE).stroke()
    y += 14

    for (const section of policy.sections) {
      y = renderSection(doc, section, y, drawHeaderFn)
    }

    // Acknowledgement block on the last page (creates new page if needed)
    y = ensureRoom(doc, 60, y, drawHeaderFn)
    y += 8
    doc.moveTo(ML, y).lineTo(PAGE_W - MR, y).lineWidth(0.5).strokeColor(COLOR_RULE).stroke()
    y += 12
    doc.font('Helvetica').fontSize(9).fillColor(COLOR_MUTED)
    doc.text(
      `This document is an authorised copy of the ${policy.title} as published on ${store.web}/legal/${policy.slug}. The official version on the website is the source of truth and may be updated from time to time.`,
      ML,
      y,
      { width: CW - 130, lineGap: 1.5, align: 'justify' }
    )

    // Stamp the seal on every page + draw the footer
    const range = doc.bufferedPageRange()
    const total = range.count
    for (let i = 0; i < total; i++) {
      doc.switchToPage(range.start + i)
      drawSeal(doc, branding?.seal)
      drawFooter(doc, store, i + 1, total)
    }

    doc.end()
  })
}
