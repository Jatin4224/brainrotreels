/**
 * SOURCE OF TRUTH KEYWORDS: htmlToReadableText, extractTitle, stripPdfFurniture,
 *   BOILERPLATE_FIRST, REPEATED_LINE_IS_FURNITURE, ENTITIES_ARE_SPOKEN,
 *   readable extraction tests
 *
 * WHAT:  Whether what reaches the model is the article or the website around it.
 * WHY:   Extraction failures are invisible in the worst way: the generation
 *        SUCCEEDS and produces a confident, well-formed script about a cookie
 *        banner. Nothing errors, the customer is charged, and the only signal
 *        is that the video is wrong. These tests are the place that failure is
 *        catchable.
 * WHERE: Run by `npm test`. Guards src/lib/script/readable.ts.
 */

import { describe, expect, it } from 'vitest'

import { extractTitle, htmlToReadableText, stripPdfFurniture } from './readable'

describe('htmlToReadableText', () => {
  it('drops navigation and chrome with their contents', () => {
    /* BOILERPLATE_FIRST — the whole reason these elements are removed before
     * tags are stripped. Left in, the model writes about the menu. */
    const html = `
      <html><head><style>.a{color:red}</style></head>
      <body>
        <nav><a href="/">Home</a><a href="/about">About</a></nav>
        <header>Subscribe now for unlimited access</header>
        <article><p>The reactor reached criticality at noon.</p></article>
        <aside>Related: five other stories</aside>
        <footer>Copyright 2026. All rights reserved.</footer>
        <script>trackPageView()</script>
      </body></html>`

    const text = htmlToReadableText(html)

    expect(text).toContain('reactor reached criticality')
    for (const chrome of [
      'Home',
      'About',
      'Subscribe now',
      'Related:',
      'Copyright',
      'trackPageView',
      'color:red',
    ]) {
      expect(text, chrome).not.toContain(chrome)
    }
  })

  it('keeps paragraphs apart instead of running them together', () => {
    /* Without block-level boundaries this reads as "...first.Second..." which
     * the model takes as one sentence. */
    const text = htmlToReadableText('<p>First idea.</p><p>Second idea.</p>')
    expect(text).not.toContain('idea.Second')
    /* A paragraph break, not a run-on and not a pile of blank lines. The
     * closing and opening tags each contribute a newline, which collapses to
     * exactly one blank line. */
    expect(text).toBe('First idea.\n\nSecond idea.')
  })

  it('decodes the entities that would otherwise be spoken aloud', () => {
    /* ENTITIES_ARE_SPOKEN — this text becomes narration. `&amp;` undecoded is
     * a voice saying "ampersand amp semicolon". */
    const text = htmlToReadableText(
      '<p>Marks &amp; Spencer&rsquo;s &ldquo;value&rdquo; range &mdash; &#163;5 &#x2014; sold out</p>',
    )
    expect(text).toContain('Marks & Spencer')
    expect(text).toContain("'s")
    expect(text).toContain('£5')
    expect(text).not.toMatch(/&[a-z]+;/i)
    expect(text).not.toMatch(/&#/)
  })

  it('does not turn doubly-encoded text back into markup', () => {
    /* `&amp;lt;` must decode to `&lt;`, not to `<`. Decoding &amp; first is
     * the ordering bug that lets encoded markup come back to life. */
    const text = htmlToReadableText('<p>&amp;lt;script&amp;gt;</p>')
    expect(text).toContain('&lt;script&gt;')
    expect(text).not.toContain('<script>')
  })

  it('collapses the whitespace extraction leaves behind', () => {
    /* Whitespace is billed. A page stripped of tags is mostly blank lines, and
     * four consecutive ones must collapse to a single paragraph break — never
     * more, and never to nothing. */
    const text = htmlToReadableText('<div>  a  </div>\n\n\n\n<div>   b   </div>')
    expect(text).toBe('a\n\nb')
    expect(text).not.toMatch(/\n{3,}/)
  })

  it('returns something usable from malformed html', () => {
    /* Customer-supplied URLs return whatever they return. This must not throw. */
    for (const broken of ['<p>unclosed', '<<<>>>', '', '   ', '<p>a</p'] ) {
      expect(() => htmlToReadableText(broken), JSON.stringify(broken)).not.toThrow()
    }
    expect(htmlToReadableText('<p>unclosed')).toContain('unclosed')
  })
})

describe('extractTitle', () => {
  it('prefers og:title over the tag, which carries site furniture', () => {
    const html = `
      <meta property="og:title" content="Reactor reaches criticality" />
      <title>Reactor reaches criticality | World | The Paper</title>`
    expect(extractTitle(html)).toBe('Reactor reaches criticality')
  })

  it('falls back to the title tag', () => {
    expect(extractTitle('<title>Just this</title>')).toBe('Just this')
  })

  it('returns undefined when there is no title', () => {
    expect(extractTitle('<p>no title here</p>')).toBeUndefined()
    expect(extractTitle('<title></title>')).toBeUndefined()
  })

  it('decodes entities in the title', () => {
    expect(extractTitle('<title>Marks &amp; Spencer</title>')).toBe('Marks & Spencer')
  })
})

describe('stripPdfFurniture', () => {
  it('removes a running header that appears on most pages', () => {
    /* REPEATED_LINE_IS_FURNITURE — a ten-page paper otherwise contributes its
     * own title ten times, which both costs tokens and tells the model that
     * phrase matters more than the argument. */
    const pages = [
      'Quarterly Report 2026\nRevenue grew by twelve percent.\n1',
      'Quarterly Report 2026\nCosts fell in every region.\n2',
      'Quarterly Report 2026\nThe outlook is unchanged.\n3',
      'Quarterly Report 2026\nRisks remain in supply.\n4',
    ]

    const text = stripPdfFurniture(pages)

    expect(text).not.toContain('Quarterly Report 2026')
    expect(text).toContain('Revenue grew')
    expect(text).toContain('Risks remain')
  })

  it('removes bare page numbers in their various shapes', () => {
    const text = stripPdfFurniture(['Body one.\n1\nPage 2\n3 of 10', 'Body two.\n2'])
    expect(text).toContain('Body one')
    expect(text).toContain('Body two')
    expect(text).not.toMatch(/^\s*\d+\s*$/m)
    expect(text).not.toContain('Page 2')
    expect(text).not.toContain('3 of 10')
  })

  it('keeps a line that is repeated within ONE page', () => {
    /* Repetition on a single page is emphasis, not furniture. Stripping it
     * would lose argument — the failure that matters more than a wasted
     * token. */
    const pages = ['Important.\nImportant.\nImportant.\nUnique one.', 'Unique two.']
    const text = stripPdfFurniture(pages)
    expect(text).toContain('Important.')
  })

  it('keeps long lines even when repeated, because sentences are not footers', () => {
    const sentence =
      'This is a long sentence that happens to be repeated across pages and is well over the eighty character limit.'
    const text = stripPdfFurniture([`${sentence}\nA.`, `${sentence}\nB.`, `${sentence}\nC.`])
    expect(text).toContain(sentence)
  })

  it('returns a single page unchanged apart from page numbers', () => {
    /* One page has no repetition to measure, so detecting furniture would be
     * guessing. */
    const text = stripPdfFurniture(['Only page.\nSome content here.\n1'])
    expect(text).toContain('Only page.')
    expect(text).toContain('Some content here.')
    expect(text).not.toMatch(/^\s*1\s*$/m)
  })

  it('handles an empty document without throwing', () => {
    expect(stripPdfFurniture([])).toBe('')
    expect(stripPdfFurniture(['', ''])).toBe('')
  })
})
