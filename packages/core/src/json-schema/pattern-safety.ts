/**
 * A conservative static check that rejects `pattern` regular expressions prone to catastrophic
 * backtracking (ReDoS). Patterns reach Toolmark from page markup and server-declared schemas while
 * the values they are run against come from agents, so a pattern must be proven "simple" before
 * it is ever executed.
 *
 * The heuristic (a pattern is rejected when any rule matches):
 *
 * 1. **Backreferences** — `\1`…`\9` (any `\<digit>` other than `\0`) and `\k<name>`.
 * 2. **Star height ≥ 2** — a quantified group (any quantifier: `*`, `+`, `?`, `{n}`, `{n,}`,
 *    `{n,m}`) whose body contains, at any depth, a variable quantifier (`*`, `+`, `?`, `{n,}` or
 *    `{n,m}` with `m > n`). Examples: `(a+)+`, `(a*)*`, `(\d+)*x`, `(.*a){11}`, `((a)+)?`. A
 *    fixed count inside (`(\d{4}){2}`) is allowed.
 * 3. **Ambiguous alternation under repetition** — inside a quantified group, every alternation
 *    (at any depth) must be deterministic: each branch is a fixed-length sequence of single
 *    atoms (literal characters, escapes, character classes, `.`; no quantifiers or groups) whose
 *    first atom is a literal character, and those first characters are pairwise distinct
 *    (compared case-insensitively). `(ab|cd)*` passes; `(a|a)*`, `(a|ab)*`, `(ab|ac)+` and
 *    `(\d|x)*` are rejected.
 *
 * The check is deliberately conservative: it may reject some safe patterns (which can always be
 * rewritten, e.g. `(\d|x)*` → `[\dx]*`). Polynomial backtracking between adjacent unbounded
 * quantifiers (e.g. `\S+@\S+`) is not rejected; it is bounded by the validator's input-length
 * cap instead.
 *
 * @param source - A pattern already known to compile with the `u` flag.
 * @returns `undefined` when the pattern is accepted, else the reason it is rejected.
 * @internal
 */
export function unsafePatternReason(source: string): string | undefined {
  try {
    const alts = new Parser(source).parse()
    analyze(alts, false)
    return undefined
  } catch (e) {
    if (e instanceof Unsafe) return e.reason
    throw e
  }
}

class Unsafe extends Error {
  constructor(readonly reason: string) {
    super(reason)
  }
}

interface Quant {
  min: number
  max: number
}
type Atom =
  { k: 'char'; c: string } | { k: 'set' } | { k: 'assert' } | { k: 'group'; alts: Term[][] }
interface Term {
  atom: Atom
  q?: Quant
}

const isVariable = (q: Quant): boolean => q.max !== q.min

class Parser {
  private i = 0
  constructor(private readonly s: string) {}

  parse(): Term[][] {
    return this.alternation()
  }

  private alternation(): Term[][] {
    const alts: Term[][] = [this.sequence()]
    while (this.s[this.i] === '|') {
      this.i++
      alts.push(this.sequence())
    }
    return alts
  }

  private sequence(): Term[] {
    const terms: Term[] = []
    while (this.i < this.s.length && this.s[this.i] !== '|' && this.s[this.i] !== ')') {
      const atom = this.atom()
      const q = this.quantifier()
      terms.push(q ? { atom, q } : { atom })
    }
    return terms
  }

  private atom(): Atom {
    const s = this.s
    const ch = s[this.i]!
    if (ch === '(') {
      this.i++
      if (s[this.i] === '?') {
        this.i++
        const n = s[this.i]
        if (n === ':' || n === '=' || n === '!') this.i++
        else if (n === '<' && (s[this.i + 1] === '=' || s[this.i + 1] === '!')) this.i += 2
        else if (n === '<') this.i = s.indexOf('>', this.i) + 1
        else this.i = s.indexOf(':', this.i) + 1 // modifiers group `(?i:…)`
      }
      const alts = this.alternation()
      this.i++ // ')'
      return { k: 'group', alts }
    }
    if (ch === '[') {
      this.i++
      while (s[this.i] !== ']') this.i += s[this.i] === '\\' ? 2 : 1
      this.i++
      return { k: 'set' }
    }
    if (ch === '.') {
      this.i++
      return { k: 'set' }
    }
    if (ch === '^' || ch === '$') {
      this.i++
      return { k: 'assert' }
    }
    if (ch === '\\') return this.escape()
    const c = String.fromCodePoint(s.codePointAt(this.i)!)
    this.i += c.length
    return { k: 'char', c }
  }

  private escape(): Atom {
    const s = this.s
    const e = s[this.i + 1]!
    this.i += 2
    if (/[1-9]/.test(e) || e === 'k') throw new Unsafe('backreferences are not allowed')
    if ('dDwWsS'.includes(e)) return { k: 'set' }
    if (e === 'p' || e === 'P') {
      this.i = s.indexOf('}', this.i) + 1
      return { k: 'set' }
    }
    if (e === 'b' || e === 'B') return { k: 'assert' }
    const simple: Record<string, string> = { n: '\n', r: '\r', t: '\t', f: '\f', v: '\v', 0: '\0' }
    if (Object.hasOwn(simple, e)) return { k: 'char', c: simple[e]! }
    if (e === 'c') {
      const code = s.charCodeAt(this.i) % 32
      this.i++
      return { k: 'char', c: String.fromCharCode(code) }
    }
    if (e === 'x') {
      const code = parseInt(s.slice(this.i, this.i + 2), 16)
      this.i += 2
      return { k: 'char', c: String.fromCharCode(code) }
    }
    if (e === 'u') {
      if (s[this.i] === '{') {
        const end = s.indexOf('}', this.i)
        const code = parseInt(s.slice(this.i + 1, end), 16)
        this.i = end + 1
        return { k: 'char', c: String.fromCodePoint(code) }
      }
      const code = parseInt(s.slice(this.i, this.i + 4), 16)
      this.i += 4
      return { k: 'char', c: String.fromCharCode(code) } // a surrogate pair is two chars
    }
    return { k: 'char', c: e } // identity escape of a syntax character
  }

  private quantifier(): Quant | undefined {
    const s = this.s
    const ch = s[this.i]
    let q: Quant | undefined
    if (ch === '*') q = { min: 0, max: Infinity }
    else if (ch === '+') q = { min: 1, max: Infinity }
    else if (ch === '?') q = { min: 0, max: 1 }
    else if (ch === '{') {
      const end = s.indexOf('}', this.i)
      const [lo, hi] = s.slice(this.i + 1, end).split(',')
      const min = Number(lo)
      q = { min, max: hi === undefined ? min : hi === '' ? Infinity : Number(hi) }
      this.i = end
    }
    if (!q) return undefined
    this.i++
    if (s[this.i] === '?') this.i++ // lazy
    return q
  }
}

function analyze(alts: Term[][], inQuantified: boolean): void {
  if (inQuantified && alts.length > 1) checkDeterministic(alts)
  for (const seq of alts) {
    for (const term of seq) {
      if (term.atom.k !== 'group') continue
      if (term.q && hasVariableQuantifier(term.atom.alts)) {
        throw new Unsafe('nested quantifiers (a quantified group containing a quantifier)')
      }
      analyze(term.atom.alts, inQuantified || term.q !== undefined)
    }
  }
}

function hasVariableQuantifier(alts: Term[][]): boolean {
  return alts.some((seq) =>
    seq.some(
      (t) =>
        (t.q !== undefined && isVariable(t.q)) ||
        (t.atom.k === 'group' && hasVariableQuantifier(t.atom.alts)),
    ),
  )
}

function checkDeterministic(alts: Term[][]): void {
  const firsts = new Set<string>()
  for (const seq of alts) {
    const first = seq[0]?.atom
    const fixed = seq.every((t) => t.q === undefined && t.atom.k !== 'group')
    if (!fixed || first?.k !== 'char') {
      throw new Unsafe('a repeated alternation must use fixed-length literal branches')
    }
    const key = first.c.toLowerCase()
    if (firsts.has(key)) {
      throw new Unsafe('a repeated alternation has branches starting with the same character')
    }
    firsts.add(key)
  }
}
