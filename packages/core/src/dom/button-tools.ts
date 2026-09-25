import { CONFIRM_SNAPSHOT, type ConfirmSnapshotHook } from '../confirm-snapshot.js'
import { deepEqual, snapshotValue } from '../forms/paths.js'
import { ok, refuse } from '../result.js'
import type { ToolDefinition, ToolHints } from '../tool.js'
import { asAgentActivation } from './activation.js'
import { cap, discover, getAttr, nestValues, readField } from './elements.js'

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
  return acts && ownerOf(button) !== null
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

/** The form a button acts on (its form owner), read through the prototype getter. */
function ownerOf(button: ToolButton): HTMLFormElement | null {
  const proto =
    button.localName === 'input' ? HTMLInputElement.prototype : HTMLButtonElement.prototype
  const form: unknown = Reflect.get(proto, 'form', button)
  return form instanceof HTMLFormElement ? form : null
}

/** The non-excluded values of `form` (the same fields its form tools read). */
function formValues(form: HTMLFormElement): unknown {
  return snapshotValue(nestValues(discover(form).fields.map((f) => [f.path, readField(f)])))
}

/**
 * @internal The action tool for a `data-tool` button (spec §10.2): no input; `run` clicks the
 * button (`HTMLElement.prototype.click`) and returns `ok({ clicked: true })`. A disabled, inert,
 * hidden (`checkVisibility()` fails) or detached button → `refused` `not_allowed`
 * "Button is disabled or hidden".
 *
 * Confirmation (fix round 1, I1): the summary is the owner form's `data-tool-confirm` while the
 * button submits or resets its form, else the button's own `data-tool-confirm`, else `fallback`.
 * The tool carries a confirm snapshot of the button's form owner and that form's non-excluded
 * values, so an approval given before the form (or the owner) changed is refused `stale` and the
 * button is not clicked. Its anchor (`tm.anchor(name)`) is the button element.
 * @param button - The button.
 * @param name - Local tool name.
 * @param description - LLM-facing description (from app-authored markup).
 * @param fallback - Summary when no `data-tool-confirm` applies (default `name`).
 */
export function buttonToolDefinition(
  button: ToolButton,
  name: string,
  description: string,
  fallback: string = name,
): ToolDefinition<unknown, { clicked: true }> & { [CONFIRM_SNAPSHOT]: ConfirmSnapshotHook } {
  const own = getAttr(button, 'data-tool-confirm')?.trim()
  const summary = (): string => {
    const form = ownerOf(button)
    const formConfirm =
      form !== null && submitsForm(button) ? getAttr(form, 'data-tool-confirm')?.trim() : undefined
    const text = formConfirm || own
    return text ? cap(text, MAX_CONFIRM_SUMMARY) : fallback
  }
  const snapshotHook: ConfirmSnapshotHook = {
    take: () => {
      const form = ownerOf(button)
      return { form, values: form ? formValues(form) : undefined }
    },
    changed: (snapshot) => {
      const snap = snapshot as { form: HTMLFormElement | null; values: unknown }
      const form = ownerOf(button)
      if (form !== snap.form) return true
      return form !== null && !deepEqual(formValues(form), snap.values)
    },
  }
  return {
    name,
    description,
    hints: buttonHints(button),
    origin: 'dom',
    // Tour hooks (spec §13): the button itself.
    anchors: { element: () => button },
    summary,
    run() {
      if (!clickable(button)) return refuse('not_allowed', 'Button is disabled or hidden')
      // The activation's trusted `submit` / `input` events are the agent's (M3 T2 fix round 1).
      asAgentActivation(() => HTMLElement.prototype.click.call(button))
      return ok({ clicked: true as const })
    },
    [CONFIRM_SNAPSHOT]: snapshotHook,
  }
}
