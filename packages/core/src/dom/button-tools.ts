import { ok, refuse } from '../result.js'
import type { ToolDefinition, ToolHints } from '../tool.js'
import { cap, getAttr } from './elements.js'

/** @internal Longest `data-tool-confirm` summary kept (longer text is truncated with `…`). */
export const MAX_CONFIRM_SUMMARY = 500

/** @internal A clickable element that can be a button tool. */
export type ToolButton = HTMLButtonElement | HTMLInputElement

const INPUT_BUTTON_TYPES = new Set(['button', 'submit', 'reset', 'image'])

/** @internal Whether `el` is a `<button>` or a button-like `<input>`. */
export function isToolButton(el: Element): el is ToolButton {
  if (el.localName === 'button') return true
  return (
    el.localName === 'input' &&
    INPUT_BUTTON_TYPES.has((getAttr(el, 'type') ?? '').trim().toLowerCase())
  )
}

/**
 * @internal Whether clicking the button would submit or reset its form: its type is `submit`
 * (explicit or the `<button>` default), `image` or `reset`, and it has a form owner.
 */
export function submitsForm(button: ToolButton): boolean {
  const type = button.type.toLowerCase()
  const acts = type === 'submit' || type === 'reset' || type === 'image'
  return acts && button.form !== null
}

/**
 * @internal Hints of a button tool (spec §10.2, §23). Always `untrustedContent`. A button that
 * submits or resets its form is at least `consequential` (`data-tool-destructive` raises it to
 * `destructive`; `data-tool-readonly` is ignored, so the tool never bypasses the confirmation a
 * form submit needs). Other buttons: `data-tool-destructive` → `destructive`,
 * `data-tool-consequential` → `consequential`, `data-tool-readonly` → `readOnly`, else no class.
 */
export function buttonHints(button: ToolButton): ToolHints {
  const has = (name: string): boolean => button.hasAttribute(name)
  if (has('data-tool-destructive')) return { destructive: true, untrustedContent: true }
  if (submitsForm(button) || has('data-tool-consequential')) {
    return { consequential: true, untrustedContent: true }
  }
  if (has('data-tool-readonly')) return { readOnly: true, untrustedContent: true }
  return { untrustedContent: true }
}

/** Whether the button can be clicked by a user right now. */
function clickable(button: ToolButton): boolean {
  if (!button.isConnected || button.matches(':disabled')) return false
  if (button.closest('[inert]') !== null) return false
  if (typeof button.checkVisibility === 'function') {
    return button.checkVisibility({ visibilityProperty: true, opacityProperty: false })
  }
  return button.getClientRects().length > 0
}

/**
 * @internal The action tool for a `data-tool` button (spec §10.2): no input; `run` clicks the
 * button (`HTMLElement.prototype.click`) and returns `ok({ clicked: true })`. A disabled, inert,
 * hidden (`checkVisibility()` fails) or detached button → `refused` `not_allowed`
 * "Button is disabled or hidden". `data-tool-confirm` becomes the confirmation summary.
 * @param button - The button.
 * @param name - Local tool name.
 * @param description - LLM-facing description (from app-authored markup).
 */
export function buttonToolDefinition(
  button: ToolButton,
  name: string,
  description: string,
): ToolDefinition<unknown, { clicked: true }> {
  const confirm = getAttr(button, 'data-tool-confirm')?.trim()
  const summary = confirm ? cap(confirm, MAX_CONFIRM_SUMMARY) : undefined
  return {
    name,
    description,
    hints: buttonHints(button),
    origin: 'dom',
    ...(summary !== undefined ? { summary: () => summary } : {}),
    run() {
      if (!clickable(button)) return refuse('not_allowed', 'Button is disabled or hidden')
      HTMLElement.prototype.click.call(button)
      return ok({ clicked: true as const })
    },
  }
}
