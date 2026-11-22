import { describe, it, expect } from 'vitest'
import { csvCell, csvRow } from '../src/export'

describe('csvCell', () => {
  it('null/undefined → empty', () => {
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
  })
  it('Date → ISO', () => {
    expect(csvCell(new Date('2026-01-02T03:04:05.000Z'))).toBe('2026-01-02T03:04:05.000Z')
  })
  it('plain string passes through', () => {
    expect(csvCell('hello')).toBe('hello')
  })
  it('neutralises formula-leading values', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(csvCell('+1')).toBe("'+1")
    expect(csvCell('@cmd')).toBe("'@cmd")
  })
  it('does NOT neutralise a plain negative number', () => {
    expect(csvCell('-42')).toBe('-42')
    expect(csvCell('-4.5')).toBe('-4.5')
  })
  it('neutralises a leading-dash non-number', () => {
    expect(csvCell('-abc')).toBe("'-abc")
  })
  it('quotes and doubles embedded quotes/commas/newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('line1\r\nline2')).toBe('"line1\r\nline2"')
  })
  it('number coerces to string', () => {
    expect(csvCell(42)).toBe('42')
  })
})

describe('csvRow', () => {
  it('joins cells with commas and a CRLF terminator', () => {
    expect(csvRow(['a', 'b,c', null])).toBe('a,"b,c",\r\n')
  })
})
