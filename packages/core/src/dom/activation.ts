/**
 * @internal Agent activation flag shared by the DOM tools (spec §13). While an agent-driven
 * activation runs (a button tool's `click()`), the events it causes synchronously — notably the
 * trusted `submit` that a submit button's activation dispatches — are the agent's, not the
 * user's, and `domFormAdapter` does not report them as interactions.
 */
let depth = 0

/** @internal Runs `fn` as an agent activation (re-entrant). */
export function asAgentActivation<T>(fn: () => T): T {
  depth++
  try {
    return fn()
  } finally {
    depth--
  }
}

/** @internal Whether an agent activation is running right now. */
export function isAgentActivation(): boolean {
  return depth > 0
}
