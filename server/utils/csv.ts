// Minimal, dependency-free CSV builder (RFC 4180). A field is quoted only when it
// contains a comma, double-quote, CR or LF, with embedded quotes doubled. A UTF-8
// BOM is prepended so Excel opens accented names correctly. Generic (headers + a
// string matrix) so any export can reuse it. Pure — unit-tested.

const BOM = String.fromCharCode(0xFEFF)

function escapeField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function buildCsv(headers: string[], rows: string[][]): string {
  return BOM + [headers, ...rows].map(row => row.map(escapeField).join(',')).join('\r\n')
}
