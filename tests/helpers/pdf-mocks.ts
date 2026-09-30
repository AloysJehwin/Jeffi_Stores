import { vi, describe, it, expect, beforeEach } from 'vitest'

// PDFKit is loaded via eval('require')('pdfkit') — vi.mock intercepts Node's
// require cache, so this mock still applies.
vi.mock('pdfkit', () => {
  function makeMockDoc() {
    let dataCb: ((c: Buffer) => void) | null = null
    let endCb: (() => void) | null = null

    const doc: Record<string, any> = {
      on: vi.fn().mockImplementation(function (event: string, cb: any) {
        if (event === 'data') dataCb = cb
        if (event === 'end') endCb = cb
        return doc
      }),
      end: vi.fn().mockImplementation(function () {
        dataCb?.(Buffer.from('mock-pdf-data'))
        endCb?.()
      }),
      // Drawing / layout methods — all chainable
      font: vi.fn().mockReturnThis(),
      fontSize: vi.fn().mockReturnThis(),
      fillColor: vi.fn().mockReturnThis(),
      strokeColor: vi.fn().mockReturnThis(),
      lineWidth: vi.fn().mockReturnThis(),
      text: vi.fn().mockReturnThis(),
      moveDown: vi.fn().mockReturnThis(),
      moveTo: vi.fn().mockReturnThis(),
      lineTo: vi.fn().mockReturnThis(),
      stroke: vi.fn().mockReturnThis(),
      fill: vi.fn().mockReturnThis(),
      rect: vi.fn().mockReturnThis(),
      circle: vi.fn().mockReturnThis(),
      image: vi.fn().mockReturnThis(),
      opacity: vi.fn().mockReturnThis(),
      addPage: vi.fn().mockReturnThis(),
      switchToPage: vi.fn().mockReturnThis(),
      flushPages: vi.fn().mockReturnThis(),
      pipe: vi.fn().mockReturnThis(),
      save: vi.fn().mockReturnThis(),
      restore: vi.fn().mockReturnThis(),
      translate: vi.fn().mockReturnThis(),
      rotate: vi.fn().mockReturnThis(),
      scale: vi.fn().mockReturnThis(),
      polygon: vi.fn().mockReturnThis(),
      path: vi.fn().mockReturnThis(),
      lineGap: vi.fn().mockReturnThis(),
      // Properties & state
      x: 50,
      y: 100,
      page: { width: 595.28, height: 841.89, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      heightOfString: vi.fn().mockReturnValue(20),
      widthOfString: vi.fn().mockReturnValue(100),
      bufferedPageRange: vi.fn().mockReturnValue({ start: 0, count: 1 }),
      // error event support
      emit: vi.fn(),
    }
    return doc
  }

  const MockPDFDocument = vi.fn().mockImplementation(() => makeMockDoc())
  return { default: MockPDFDocument }
})

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,mockqr') },
  toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,mockqr'),
}))

vi.mock('@/lib/shared/db', () => ({
  queryMany: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
  query: vi.fn().mockResolvedValue({ rows: [] }),
  withTransaction: vi.fn(),
}))

// Export the mock factory so individual test files can import it
export function makePdfDocMock() {
  let dataCb: ((c: Buffer) => void) | null = null
  let endCb: (() => void) | null = null
  const doc: Record<string, any> = {
    on: vi.fn().mockImplementation(function (event: string, cb: any) {
      if (event === 'data') dataCb = cb
      if (event === 'end') endCb = cb
      return doc
    }),
    end: vi.fn().mockImplementation(function () {
      dataCb?.(Buffer.from('mock-pdf-data'))
      endCb?.()
    }),
    font: vi.fn().mockReturnThis(),
    fontSize: vi.fn().mockReturnThis(),
    fillColor: vi.fn().mockReturnThis(),
    strokeColor: vi.fn().mockReturnThis(),
    lineWidth: vi.fn().mockReturnThis(),
    text: vi.fn().mockReturnThis(),
    moveDown: vi.fn().mockReturnThis(),
    moveTo: vi.fn().mockReturnThis(),
    lineTo: vi.fn().mockReturnThis(),
    stroke: vi.fn().mockReturnThis(),
    fill: vi.fn().mockReturnThis(),
    rect: vi.fn().mockReturnThis(),
    circle: vi.fn().mockReturnThis(),
    image: vi.fn().mockReturnThis(),
    opacity: vi.fn().mockReturnThis(),
    addPage: vi.fn().mockReturnThis(),
    switchToPage: vi.fn().mockReturnThis(),
    bufferedPageRange: vi.fn().mockReturnValue({ start: 0, count: 1 }),
    heightOfString: vi.fn().mockReturnValue(20),
    widthOfString: vi.fn().mockReturnValue(100),
    x: 50,
    y: 100,
    page: { width: 595.28, height: 841.89, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
  }
  return doc
}
