// A deliberately small Markdown renderer for the legal documents in `docs/legal/`.
//
// WHY NOT A LIBRARY: the legal pages must render the *same bytes* a lawyer
// reviewed and git versions. Retyping the documents into Vue templates would let
// the rendered page and the reviewed source drift — and a terms page that differs
// from the accepted document is the one bug in this area that actually matters.
// Importing the .md with `?raw` removes that risk; all that is then missing is a
// renderer for the small subset of Markdown these documents use.
//
// Supported, because the documents use exactly this and nothing more: ATX
// headings, paragraphs, unordered and ordered lists (with indented continuation
// lines), tables, blockquotes, horizontal rules, checkbox items, and the inline
// forms bold / italic / code / link. Anything else renders as literal text rather
// than silently disappearing.
//
// Input is trusted (our own repository), but every span is HTML-escaped before
// formatting is applied anyway — so a stray `<` in a legal clause renders as a
// `<` instead of opening a tag.

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// A sentinel that cannot occur in a source document and survives HTML escaping,
// so a code span can be lifted out and put back afterwards without an ordinary
// number in a legal clause being mistaken for a placeholder.
const CODE_MARK = '\u0000'
const CODE_PLACEHOLDER = new RegExp(`${CODE_MARK}(\\d+)${CODE_MARK}`, 'g')

// Inline formatting, applied after escaping. Code spans are extracted first and
// restored last so that markup inside them stays literal.
function renderInline(value: string): string {
  const codeSpans: string[] = []
  const withPlaceholders = value.replace(/`([^`]+)`/g, (_match, code: string) => {
    codeSpans.push(code)
    return `${CODE_MARK}${codeSpans.length - 1}${CODE_MARK}`
  })

  let html = escapeHtml(withPlaceholders)

  // Links before emphasis: a label may itself contain bold.
  html = html.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_match, label: string, href: string) =>
      `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`
  )

  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')

  return html.replace(CODE_PLACEHOLDER, (_match, index: string) => `<code>${escapeHtml(codeSpans[Number(index)] ?? '')}</code>`)
}

function renderCells(row: string): string[] {
  return row
    .replace(/^\||\|$/g, '')
    .split('|')
    .map(cell => cell.trim())
}

function isTableSeparator(line: string): boolean {
  return /^\|?[\s:-]+\|[\s|:-]*$/.test(line) && line.includes('-')
}

// A list item's text, or null when the line does not start one.
function listItemText(line: string): { text: string, ordered: boolean } | null {
  const unordered = /^[-*]\s+(.*)$/.exec(line)
  if (unordered) {
    return { text: unordered[1] ?? '', ordered: false }
  }
  const ordered = /^\d+\.\s+(.*)$/.exec(line)
  if (ordered) {
    return { text: ordered[1] ?? '', ordered: true }
  }
  return null
}

function renderItem(text: string): string {
  // `- [ ]` / `- [x]` — the consent templates use these as printable boxes, so
  // they render as glyphs rather than interactive inputs.
  const checkbox = /^\[([ xX])\]\s*(.*)$/.exec(text)
  if (checkbox) {
    const checked = checkbox[1] !== ' '
    return `<span class="md-check">${checked ? '☑' : '☐'}</span> ${renderInline(checkbox[2] ?? '')}`
  }
  return renderInline(text)
}

export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''
    const trimmed = line.trim()

    if (trimmed === '') {
      index += 1
      continue
    }

    // Horizontal rule.
    if (/^-{3,}$/.test(trimmed) || /^\*{3,}$/.test(trimmed)) {
      out.push('<hr>')
      index += 1
      continue
    }

    // Heading.
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed)
    if (heading) {
      const level = heading[1]?.length ?? 1
      out.push(`<h${level}>${renderInline(heading[2] ?? '')}</h${level}>`)
      index += 1
      continue
    }

    // Blockquote — gathered, stripped of its markers, then rendered recursively
    // so a quote can hold headings, lists and tables like the rest of the page.
    if (trimmed.startsWith('>')) {
      const quoted: string[] = []
      while (index < lines.length && (lines[index] ?? '').trim().startsWith('>')) {
        quoted.push((lines[index] ?? '').trim().replace(/^>\s?/, ''))
        index += 1
      }
      out.push(`<blockquote>${renderMarkdown(quoted.join('\n'))}</blockquote>`)
      continue
    }

    // Table — only when the following line is a separator, so a stray pipe in a
    // sentence never starts one.
    if (trimmed.startsWith('|') && isTableSeparator((lines[index + 1] ?? '').trim())) {
      const header = renderCells(trimmed)
      index += 2
      const body: string[][] = []
      while (index < lines.length && (lines[index] ?? '').trim().startsWith('|')) {
        body.push(renderCells((lines[index] ?? '').trim()))
        index += 1
      }
      const head = header.map(cell => `<th>${renderInline(cell)}</th>`).join('')
      const rows = body
        .map(row => `<tr>${row.map(cell => `<td>${renderInline(cell)}</td>`).join('')}</tr>`)
        .join('')
      out.push(`<div class="md-table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`)
      continue
    }

    // List. Continuation lines are indented under their item (the numbered
    // clauses in the terms use `a)` / `b)` sub-points that way), so they are
    // appended to the item rather than starting a paragraph.
    const first = listItemText(trimmed)
    if (first) {
      const ordered = first.ordered
      const items: string[] = []
      let current = first.text
      index += 1

      while (index < lines.length) {
        const next = lines[index] ?? ''
        if (next.trim() === '') {
          break
        }
        const item = listItemText(next.trim())
        if (item && item.ordered === ordered) {
          items.push(current)
          current = item.text
          index += 1
          continue
        }
        if (/^\s+\S/.test(next)) {
          current += `<br>${next.trim()}`
          index += 1
          continue
        }
        break
      }
      items.push(current)

      const tag = ordered ? 'ol' : 'ul'
      const rendered = items
        .map(item => `<li>${item.split('<br>').map(renderItem).join('<br>')}</li>`)
        .join('')
      out.push(`<${tag}>${rendered}</${tag}>`)
      continue
    }

    // Paragraph — consecutive lines until a blank line or the start of any block.
    const paragraph: string[] = [trimmed]
    index += 1
    while (index < lines.length) {
      const next = (lines[index] ?? '').trim()
      if (
        next === ''
        || next.startsWith('#')
        || next.startsWith('>')
        || next.startsWith('|')
        || /^-{3,}$/.test(next)
        || listItemText(next)
      ) {
        break
      }
      paragraph.push(next)
      index += 1
    }
    out.push(`<p>${renderInline(paragraph.join(' '))}</p>`)
  }

  return out.join('\n')
}
