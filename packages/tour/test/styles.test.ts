import { describe, expect, it } from 'vitest'
import css from '../src/styles.css?raw'

/** Every style rule's selector list, including rules nested in `@media`/`@supports`. */
function selectors(rules: CSSRuleList): string[] {
  const out: string[] = []
  for (const rule of rules) {
    if (rule instanceof CSSStyleRule) out.push(...rule.selectorText.split(',').map((s) => s.trim()))
    else if (rule instanceof CSSGroupingRule) out.push(...selectors(rule.cssRules))
  }
  return out
}

function mediaRules(rules: CSSRuleList): CSSMediaRule[] {
  return [...rules].filter((r): r is CSSMediaRule => r instanceof CSSMediaRule)
}

describe('styles.css', () => {
  it('styles_scoped_to_root_class', () => {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(css)
    const all = selectors(sheet.cssRules)
    expect(all.length).toBeGreaterThan(5)
    for (const s of all) expect(s.startsWith('.toolmark-tour'), s).toBe(true)
    expect(css).not.toMatch(/@import/)

    // The Global-constraint variables with their defaults.
    for (const [name, value] of [
      ['accent', '#1d4ed8'],
      ['bg', '#ffffff'],
      ['fg', '#111827'],
      ['radius', '8px'],
      // Prettier writes `.2` as `0.2` (same value).
      ['shadow', '0 8px 24px rgb(0 0 0 / 0.2)'],
      ['z', '2147483000'],
      ['backdrop', 'rgb(0 0 0 / 0.45)'],
    ]) {
      expect(css).toContain(`var(--toolmark-tour-${name}, ${value})`)
    }

    // Forced colours use system colours; reduced motion drops transitions.
    const media = mediaRules(sheet.cssRules)
    const forced = media.find((m) => m.conditionText.includes('forced-colors'))
    expect(forced).toBeTruthy()
    const forcedText = [...forced!.cssRules].map((r) => r.cssText).join('\n')
    for (const c of ['canvas', 'canvastext', 'highlight'])
      expect(forcedText.toLowerCase()).toContain(c)
    const reduced = media.find((m) => m.conditionText.includes('prefers-reduced-motion'))
    expect(reduced).toBeTruthy()
    expect([...reduced!.cssRules].map((r) => r.cssText).join('\n')).toMatch(/transition: none/)
  })
})
