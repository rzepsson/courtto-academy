import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_CONSENT_TYPES,
  LEGAL_DOCUMENTS,
  LEGAL_DOCUMENT_VERSIONS,
  hasAccountConsent,
  isAccountConsentType,
  isLegalDocument,
  needsReacceptance
} from '../../shared/legal'
import { renderMarkdown } from '../../app/utils/markdown'

const root = resolve(__dirname, '../..')
const docPath = (relative: string) => resolve(root, 'docs/legal', relative)

describe('legal document versions', () => {
  it('declares a version for every document', () => {
    for (const document of LEGAL_DOCUMENTS) {
      expect(LEGAL_DOCUMENT_VERSIONS[document]).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('recognises known documents and rejects anything else', () => {
    expect(isLegalDocument('terms')).toBe(true)
    expect(isLegalDocument('privacy')).toBe(true)
    expect(isLegalDocument('cookies')).toBe(false)
  })

  // The version string on disk is what a reviewer signed off on; the constant is
  // what gets recorded against a user's acceptance. If they drift, the trail says
  // someone agreed to a wording that was never served.
  it('matches the version stated in each source document', () => {
    const files: Record<(typeof LEGAL_DOCUMENTS)[number], string> = {
      terms: 'pl/regulamin.md',
      privacy: 'pl/polityka-prywatnosci.md'
    }

    for (const document of LEGAL_DOCUMENTS) {
      const source = readFileSync(docPath(files[document]), 'utf8')
      expect(source).toContain(`**Wersja:** ${LEGAL_DOCUMENT_VERSIONS[document]}`)
    }
  })
})

describe('needsReacceptance', () => {
  it('treats a missing acceptance as needing one', () => {
    // An account created before the trail existed has no row. Silence is not
    // agreement — it must be asked, never assumed.
    expect(needsReacceptance(null)).toBe(true)
    expect(needsReacceptance(undefined)).toBe(true)
  })

  it('is satisfied when both versions are current', () => {
    expect(
      needsReacceptance({
        termsVersion: LEGAL_DOCUMENT_VERSIONS.terms,
        privacyVersion: LEGAL_DOCUMENT_VERSIONS.privacy,
        acceptedAt: new Date()
      })
    ).toBe(false)
  })

  it('triggers when either document has moved on', () => {
    expect(
      needsReacceptance({
        termsVersion: '1970-01-01',
        privacyVersion: LEGAL_DOCUMENT_VERSIONS.privacy,
        acceptedAt: new Date()
      })
    ).toBe(true)

    expect(
      needsReacceptance({
        termsVersion: LEGAL_DOCUMENT_VERSIONS.terms,
        privacyVersion: '1970-01-01',
        acceptedAt: new Date()
      })
    ).toBe(true)
  })
})

describe('account consent', () => {
  // The omission is the doctrine: running the service someone signed up for is
  // performed on the basis of the contract, never consent. A "consent to process
  // my data" checkbox would be withdrawable at will, which would mean shutting
  // off a paid account mid-term to honour a withdrawal.
  it('covers only genuinely consent-based purposes', () => {
    expect([...ACCOUNT_CONSENT_TYPES]).toEqual(['marketing'])
    expect(isAccountConsentType('dataProcessing')).toBe(false)
    expect(isAccountConsentType('terms')).toBe(false)
  })

  it('never reads absence or an unknown value as permission', () => {
    expect(hasAccountConsent(null)).toBe(false)
    expect(hasAccountConsent(undefined)).toBe(false)
    expect(hasAccountConsent({ status: 'withdrawn' })).toBe(false)
    expect(hasAccountConsent({ status: 'whatever' })).toBe(false)
    expect(hasAccountConsent({ status: 'granted' })).toBe(true)
  })
})

describe('renderMarkdown', () => {
  it('renders headings, paragraphs and inline formatting', () => {
    const html = renderMarkdown('# Tytuł\n\nZwykły **pogrubiony** tekst.')
    expect(html).toContain('<h1>Tytuł</h1>')
    expect(html).toContain('<strong>pogrubiony</strong>')
  })

  it('renders ordered lists with indented sub-points folded into the item', () => {
    const html = renderMarkdown('1. Usługodawca świadczy:\n   a) hosting;\n   b) pocztę.\n2. Drugi punkt.')
    expect(html).toContain('<ol>')
    expect(html).toContain('a) hosting;')
    expect(html).toContain('<li>Drugi punkt.</li>')
    // The sub-points belong to the first item, so there are exactly two.
    expect(html.match(/<li>/g)).toHaveLength(2)
  })

  it('renders tables, which the retention and sub-processor sections rely on', () => {
    const html = renderMarkdown('| Dane | Okres |\n|---|---|\n| Sesje | 30 dni |')
    expect(html).toContain('<th>Dane</th>')
    expect(html).toContain('<td>30 dni</td>')
  })

  it('does not mistake a stray pipe in a sentence for a table', () => {
    const html = renderMarkdown('| to nie jest tabela')
    expect(html).toContain('<p>')
    expect(html).not.toContain('<table>')
  })

  it('renders checkbox items as printable glyphs', () => {
    const html = renderMarkdown('- [ ] strona internetowa\n- [x] media społecznościowe')
    expect(html).toContain('☐')
    expect(html).toContain('☑')
  })

  it('escapes HTML so a stray angle bracket never opens a tag', () => {
    const html = renderMarkdown('Kontakt: <script>alert(1)</script>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('keeps markup inside code spans literal', () => {
    const html = renderMarkdown('Pole `member_profile.notes` oraz `<b>`.')
    expect(html).toContain('<code>member_profile.notes</code>')
    expect(html).toContain('<code>&lt;b&gt;</code>')
  })

  it('does not mistake an ordinary number for a code placeholder', () => {
    // The placeholder used internally must not collide with plain text such as
    // an article reference, or clauses would silently vanish.
    const html = renderMarkdown('Zgodnie z art. 0 ust. 0 ustawy `x` obowiązuje.')
    expect(html).toContain('art. 0 ust. 0')
    expect(html).toContain('<code>x</code>')
  })

  it('renders links with safe attributes', () => {
    const html = renderMarkdown('Zobacz [politykę](https://example.com/p).')
    expect(html).toContain('href="https://example.com/p"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('renders every shipped legal document without leaving raw markup behind', () => {
    const documents = [
      'pl/regulamin.md',
      'pl/polityka-prywatnosci.md',
      'pl/umowa-powierzenia.md',
      'pl/wzory-zgod.md',
      'en/terms-of-service.md',
      'en/privacy-policy.md'
    ]

    for (const relative of documents) {
      const html = renderMarkdown(readFileSync(docPath(relative), 'utf8'))
      expect(html.length).toBeGreaterThan(1000)
      // Unconsumed table pipes or heading markers would mean a block type the
      // renderer silently dropped through to a paragraph.
      expect(html).not.toContain('|---')
      expect(html).not.toMatch(/<p>#{1,6}\s/)
    }
  })
})
