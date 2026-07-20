import { describe, expect, it } from 'vitest'
import { buildCsv } from '../../server/utils/csv'

const BOM = String.fromCharCode(0xFEFF)

describe('buildCsv', () => {
  it('prepends a BOM and joins rows with CRLF', () => {
    const csv = buildCsv(['a', 'b'], [['1', '2'], ['3', '4']])
    expect(csv).toBe(`${BOM}a,b\r\n1,2\r\n3,4`)
  })

  it('emits just the header row when there are no data rows', () => {
    expect(buildCsv(['name', 'email'], [])).toBe(`${BOM}name,email`)
  })

  it('quotes fields containing a comma, quote or newline and doubles embedded quotes', () => {
    const csv = buildCsv(['name', 'note'], [
      ['Doe, Jane', 'she said "hi"'],
      ['multi\nline', 'plain']
    ])
    expect(csv).toBe(`${BOM}name,note\r\n"Doe, Jane","she said ""hi"""\r\n"multi\nline",plain`)
  })

  it('leaves ordinary fields unquoted', () => {
    expect(buildCsv(['x'], [['simple']])).toBe(`${BOM}x\r\nsimple`)
  })
})
