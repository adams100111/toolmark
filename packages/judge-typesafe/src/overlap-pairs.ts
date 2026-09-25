/**
 * Name suffixes after which a tool's overlap "scope" drops the last **two** dot segments instead
 * of one (Task 4 brief): these are all action-shaped leaves of a form or wizard (fill/submit,
 * options lookups, wizard navigation), so what matters for confusability is their shared form or
 * wizard prefix, not their own verb.
 */
const TWO_SEGMENT_SUFFIXES = [
  '.fill',
  '.submit',
  '.options',
  '.goTo',
  '.next',
  '.previous',
  '.step.fill',
]

function dropSegments(name: string, count: number): string {
  const segments = name.split('.')
  return segments.slice(0, Math.max(0, segments.length - count)).join('.')
}

/** A tool's overlap scope: its name minus the last one or two segments (see {@link TWO_SEGMENT_SUFFIXES}). */
export function scopeOf(name: string): string {
  const dropTwo = TWO_SEGMENT_SUFFIXES.some((suffix) => name.endsWith(suffix))
  return dropSegments(name, dropTwo ? 2 : 1)
}

/** A tool's name minus its last segment, used only to detect siblings of the same form/wizard. */
function parentOf(name: string): string {
  return dropSegments(name, 1)
}

/** One candidate overlap pair, by original index into the page's `tools` array. */
export interface OverlapPair {
  i: number
  j: number
}

/**
 * Candidate pairs for the `judge/overlap` question (Task 4 brief): tools sharing a {@link scopeOf}
 * are compared, except pairs that are siblings of the very same form/wizard (equal {@link
 * parentOf}) — a `.fill` and its own `.submit` are expected to coexist, not "confusable". Grouping
 * by scope first keeps this near-linear instead of comparing every tool on the page pairwise
 * (avoids the quadratic blow-up the M4 audit flagged), and pairs come out in name order, matching
 * the brief's truncation rule ("in name order").
 */
export function overlapPairs(tools: readonly { name: string }[]): OverlapPair[] {
  const byIndex = tools.map((tool, index) => ({ index, name: tool.name }))
  const sorted = [...byIndex].sort((a, b) => a.name.localeCompare(b.name))

  const groups = new Map<string, typeof sorted>()
  for (const entry of sorted) {
    const scope = scopeOf(entry.name)
    const group = groups.get(scope)
    if (group) group.push(entry)
    else groups.set(scope, [entry])
  }

  const pairs: OverlapPair[] = []
  for (const [, group] of groups) {
    if (group.length < 2) continue
    for (let a = 0; a < group.length; a++) {
      for (let b = a + 1; b < group.length; b++) {
        const first = group[a]!
        const second = group[b]!
        if (parentOf(first.name) === parentOf(second.name)) continue
        pairs.push({ i: first.index, j: second.index })
      }
    }
  }
  return pairs
}
