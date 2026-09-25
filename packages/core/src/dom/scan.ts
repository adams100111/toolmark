import { ToolmarkError } from '../errors.js'
import { createFormTools } from '../forms/form-tools.js'
import type { OptionsProvider } from '../forms/types.js'
import { fromJsonSchema } from '../json-schema/from-json-schema.js'
import { isValidToolName } from '../names.js'
import { emitEvent, registryState, type Toolmark } from '../registry.js'
import type { Scope } from '../scope.js'
import type { ToolDefinition, ToolHints, ToolOrigin } from '../tool.js'
import {
  buttonToolDefinition,
  isToolButton,
  MAX_CONFIRM_SUMMARY,
  submitsForm,
} from './button-tools.js'
import { cap, discoverFields, getAttr, isReadOnly } from './elements.js'
import { domFormAdapter } from './form-adapter.js'
import { optionsUrlProvider, resolveOptionsUrl } from './options-url.js'
import { synthesizeForm } from './synthesize.js'
import { tableColumns, tableToolDefinition } from './table-tools.js'

/** Options for {@link scanDom}. */
export interface ScanDomOptions {
  /**
   * What to scan (default `document`). It must hold only app-authored markup (spec §10.2, §14);
   * put user-authored HTML under `[data-tool-ignore]`.
   */
  root?: Document | Element | ShadowRoot
  /** Keep tools in sync with the DOM through `MutationObserver`s (default `true`). */
  observe?: boolean
}

/** Longest tool description taken from markup. */
const MAX_TOOL_DESCRIPTION = 2048

const OBSERVE: MutationObserverInit = {
  subtree: true,
  childList: true,
  attributes: true,
  characterData: true,
}

// --- clobbering-safe DOM access (a form's named controls shadow its own properties) ----------

const localNameOf = (el: Element): string => String(Reflect.get(Element.prototype, 'localName', el))
const hasAttr = (el: Element, name: string): boolean =>
  Element.prototype.hasAttribute.call(el, name)
const childrenOf = (node: Document | Element | ShadowRoot): Element[] =>
  Array.from(
    node instanceof Element ? Reflect.get(Element.prototype, 'children', node) : node.children,
  )
const shadowOf = (el: Element): ShadowRoot | null =>
  Reflect.get(Element.prototype, 'shadowRoot', el)
const parentOf = (node: Node): Node | null => Reflect.get(Node.prototype, 'parentNode', node)

/** Whether `el` starts a subtree that is never scanned (user HTML, other documents, inert templates). */
function isIgnoredElement(el: Element): boolean {
  const name = localNameOf(el)
  if (name === 'iframe' || name === 'template') return true
  if (hasAttr(el, 'data-tool-ignore')) return true
  const editable = getAttr(el, 'contenteditable')
  return editable !== null && editable.trim().toLowerCase() !== 'false'
}

/** Whether `node` or an ancestor (across shadow hosts) is ignored. */
function isInIgnoredRegion(node: Node): boolean {
  for (let n: Node | null = node; n;) {
    if (n instanceof Element && isIgnoredElement(n)) return true
    const parent = parentOf(n)
    n = parent instanceof ShadowRoot ? parent.host : parent
  }
  return false
}

/** The `data-tool-group` of the closest ancestor (across open shadow hosts), stopping at `root`. */
function groupOf(el: Element, root: Node): string | undefined {
  for (let n: Node | null = parentOf(el); n && n !== root;) {
    if (n instanceof Element && hasAttr(n, 'data-tool-group')) {
      return (getAttr(n, 'data-tool-group') ?? '').trim()
    }
    n = n instanceof ShadowRoot ? n.host : parentOf(n)
  }
  return undefined
}

/**
 * Elements whose subtree (text, children, attributes) feeds a tool's definition: forms and their
 * controls, labels (field descriptions), options, fieldsets/legends, tool elements and tables.
 */
const TOOL_CONTEXT =
  'form,input,select,textarea,button,option,optgroup,datalist,fieldset,legend,label,output,' +
  'table[data-tool],[data-tool],[toolname],[data-tool-group]'

/** Attributes that make or unmake tools or ignored regions wherever they appear. */
const isToolAttribute = (name: string): boolean =>
  name.startsWith('data-tool') ||
  name.startsWith('tool') ||
  name === 'contenteditable' ||
  name === 'form'

const closestOf = (el: Element, selector: string): Element | null =>
  Element.prototype.closest.call(el, selector)

/** Whether an added or removed node can carry tools (or a shadow root that might). */
function nodeMatters(node: Node): boolean {
  if (!(node instanceof Element) || isIgnoredElement(node)) return false
  if (localNameOf(node).includes('-') || shadowOf(node) !== null) return true
  return (
    Element.prototype.matches.call(node, TOOL_CONTEXT) ||
    Element.prototype.querySelector.call(node, TOOL_CONTEXT) !== null
  )
}

/**
 * I5: whether a mutation can change the scanned tools. Records inside ignored regions never do
 * (streaming user content), except for the attribute that creates or removes the region itself;
 * elsewhere only records touching forms, form controls, labels, tool elements or tool attributes
 * count. The rest (animations, unrelated text updates) schedule no rescan.
 */
function isRelevantMutation(record: MutationRecord): boolean {
  const target = record.target
  if (record.type === 'attributes') {
    const attr = record.attributeName ?? ''
    const el = target as Element
    if (attr === 'data-tool-ignore' || attr === 'contenteditable') {
      const parent = parentOf(el)
      return parent === null || !isInIgnoredRegion(parent)
    }
    if (isInIgnoredRegion(el)) return false
    return isToolAttribute(attr) || closestOf(el, TOOL_CONTEXT) !== null
  }
  if (isInIgnoredRegion(target)) return false
  const el = target instanceof Element ? target : (target as CharacterData).parentElement
  if (el && closestOf(el, TOOL_CONTEXT) !== null) return true
  if (record.type === 'characterData') return false
  for (const n of record.addedNodes) if (nodeMatters(n)) return true
  for (const n of record.removedNodes) if (nodeMatters(n)) return true
  return false
}

interface Candidates {
  forms: HTMLFormElement[]
  buttons: Element[]
  tables: HTMLTableElement[]
  shadowRoots: ShadowRoot[]
}

/** Collects tool candidates under `root`, skipping ignored subtrees, entering open shadow roots. */
function collect(root: Document | Element | ShadowRoot): Candidates {
  const out: Candidates = { forms: [], buttons: [], tables: [], shadowRoots: [] }
  if (root instanceof Element ? isInIgnoredRegion(root) : isInIgnoredRegion(root)) return out
  const stack: Array<Document | Element | ShadowRoot> = [root]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (node instanceof Element) {
      if (node !== root && isIgnoredElement(node)) continue
      const name = localNameOf(node)
      if (name === 'form') out.forms.push(node as HTMLFormElement)
      else if (name === 'table' && hasAttr(node, 'data-tool')) {
        out.tables.push(node as HTMLTableElement)
      } else if (hasAttr(node, 'data-tool') && isToolButton(node)) out.buttons.push(node)
      const shadow = shadowOf(node)
      if (shadow) {
        out.shadowRoots.push(shadow)
        stack.push(shadow)
      }
    }
    const children = childrenOf(node)
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!)
  }
  return out
}

/** A planned tool registration: its comparison `signature` and how to build it. */
interface Plan {
  signature: string
  build(): () => void
}

/** A live element registration. */
interface Live {
  signature: string
  dispose(): void
}

/**
 * Scans the DOM for declarative tools and keeps them registered (spec §10.2). Use it as a
 * consumer: `tm.use(scanDom())`.
 *
 * - **Trusted root:** nothing under `[data-tool-ignore]`, `[contenteditable]` (any value but
 *   `"false"`), `<iframe>` or `<template>` is scanned (nor anything at all when `root` itself is
 *   inside such a region). Tool and field descriptions come from the scanned markup, which must be
 *   app-authored (§14).
 * - **Forms:** a form with native `toolname` + `tooldescription` registers `<toolname>.fill` /
 *   `.submit` (and `.options`) through {@link domFormAdapter} and the synthesized schema, with
 *   `origin: 'native-form'` and `nativeName = toolname` on `.fill` and `.submit`;
 *   `toolautosubmit` removes the submit's confirmation hint, otherwise it is `consequential`. A
 *   form with `data-tool` + `data-tool-description` registers the same with `origin: 'dom'`
 *   (`data-tool-destructive` makes its submit `destructive`; `data-tool-confirm` is its submit
 *   summary). `data-tool-options-url` on a field adds a same-origin options lookup (other URLs
 *   are ignored with an `options_url_rejected` event). Fill and submit results are marked
 *   `untrustedContent`.
 * - **Buttons** (`<button>` / button `<input>` with `data-tool` and `data-tool-description`;
 *   without a description the button is skipped with an `invalid_name` event in development,
 *   never described from its text) → an action tool that clicks the button; a button that
 *   submits or resets its form is always at least `consequential`, uses the form's
 *   `data-tool-confirm` as its summary, and its approval is refused `stale` when the form's
 *   values changed after the confirmation was requested.
 * - **Tables** with `data-tool` and `th[data-tool-column]` (at most 32 columns) → a read-only
 *   query tool whose rows are capped at 200 000 JSON characters (`truncated: true`).
 * - `data-tool-group` on an ancestor puts the tools in a scope of that name. An invalid tool or
 *   group name is skipped with an `invalid_name` event (never thrown, also in development);
 *   registration errors are reported as `error` events too.
 * - **Observation** (`observe`, default `true`): one `MutationObserver` watches `root` and every
 *   open shadow root found; only mutations touching forms, form controls, labels, tool elements
 *   or tool attributes outside ignored regions schedule a rescan; changes are batched per
 *   animation frame; a tool is re-registered only when its synthesized schema (load-time
 *   `default`s aside) or tool attributes changed; removed elements' tools and form adapters are
 *   disposed.
 *
 * Without `document` (SSR) it does nothing.
 * @param opts - `root` (default `document`) and `observe` (default `true`).
 * @returns A consumer for `tm.use`; its disposer disconnects the observer and disposes every
 * adapter, tool and group scope it created.
 */
export function scanDom(opts: ScanDomOptions = {}): (tm: Toolmark) => () => void {
  return (tm) => {
    if (typeof document === 'undefined') return () => undefined
    const root = opts.root ?? document
    const live = new Map<Element, Live>()
    const groups = new Map<string, Scope>()
    const observed = new WeakSet<Node>()
    let disposed = false
    let frame: { cancel(): void } | undefined

    const dev = registryState(tm)?.dev === true
    const report = (code: string, message: string, tool?: string, cause?: unknown): void =>
      emitEvent(tm, 'error', {
        code,
        message,
        ...(tool !== undefined ? { tool } : {}),
        ...(cause !== undefined ? { cause } : {}),
      })
    /** Runs `fn`, turning a thrown error into an `error` event (the observer never throws). */
    const guarded = <T>(tool: string, fn: () => T): T | undefined => {
      try {
        return fn()
      } catch (e) {
        if (e instanceof ToolmarkError) report(e.code, e.message, tool, e)
        else report('tool_threw', `Registering DOM tool "${tool}" failed`, tool, e)
        return undefined
      }
    }

    const scopeFor = (group: string | undefined): Scope | undefined => {
      if (group === undefined) return undefined
      let scope = groups.get(group)
      if (!scope) groups.set(group, (scope = tm.scope(group)))
      return scope
    }

    /**
     * Validates the tool's name and group; returns the full name (of the tool, or of its `.fill`
     * for forms) or reports `invalid_name`.
     */
    const checkName = (name: string, group: string | undefined, suffix: string): boolean => {
      const full = `${group !== undefined ? `${group}.` : ''}${name}`
      const ok =
        name !== '' &&
        isValidToolName(`${full}${suffix}`) &&
        (group === undefined || (group !== '' && isValidToolName(group)))
      if (!ok) {
        report(
          'invalid_name',
          `DOM tool "${cap(full, 200)}" skipped: tool and group names use 1-128 characters from ` +
            `A-Z a-z 0-9 _ - .`,
        )
      }
      return ok
    }

    /** A registration placeholder for an element whose tool could not be registered. */
    const skip = (): (() => void) => () => undefined

    const planForm = (form: HTMLFormElement): Plan | undefined => {
      const toolname = getAttr(form, 'toolname')?.trim()
      const tooldescription = getAttr(form, 'tooldescription')?.trim()
      const dataTool = getAttr(form, 'data-tool')?.trim()
      const dataDescription = getAttr(form, 'data-tool-description')?.trim()
      let origin: ToolOrigin
      let name: string
      let description: string
      if (toolname && tooldescription) {
        origin = 'native-form'
        name = toolname
        description = tooldescription
      } else if (dataTool && dataDescription) {
        origin = 'dom'
        name = dataTool
        description = dataDescription
      } else {
        return undefined
      }
      description = cap(description, MAX_TOOL_DESCRIPTION)
      const group = groupOf(form, root)
      const autosubmit = origin === 'native-form' && hasAttr(form, 'toolautosubmit')
      const destructive = origin === 'dom' && hasAttr(form, 'data-tool-destructive')
      const confirmText = origin === 'dom' ? getAttr(form, 'data-tool-confirm')?.trim() : undefined
      const s = synthesizeForm(form)
      const optionUrls: Record<string, { raw: string; el: Element }> = {}
      for (const f of discoverFields(form)) {
        const raw = getAttr(f.element, 'data-tool-options-url')
        if (raw === null || isReadOnly(f.element)) continue
        const key = f.index !== undefined ? `${f.path}[]` : f.path
        if (!Object.hasOwn(optionUrls, key)) {
          Object.defineProperty(optionUrls, key, {
            value: { raw: raw.trim(), el: f.element },
            enumerable: true,
          })
        }
      }
      const signature = JSON.stringify({
        kind: 'form',
        origin,
        name,
        description,
        group,
        autosubmit,
        destructive,
        confirmText,
        // Schema `default`s (load-time values) are left out: frameworks that keep the `value`
        // attribute in sync (controlled inputs) would otherwise re-register on every keystroke.
        schema: withoutDefaults(s.schema),
        validationSchema: withoutDefaults(s.validationSchema),
        files: s.files,
        skipped: s.skipped,
        options: Object.entries(optionUrls).map(([k, v]) => [k, v.raw]),
      })
      return {
        signature,
        build: () => {
          const options: Record<string, OptionsProvider> = {}
          const rejectedUrls: Array<[string, string]> = []
          for (const [key, { raw, el }] of Object.entries(optionUrls)) {
            const resolved = resolveOptionsUrl(raw, el)
            if ('rejected' in resolved) {
              rejectedUrls.push([key, resolved.rejected])
              continue
            }
            Object.defineProperty(options, key, {
              value: optionsUrlProvider(resolved.url),
              enumerable: true,
            })
          }
          const hasOptions = Object.keys(options).length > 0
          // The longest suffix actually registered: `.options` (8) when options exist, else `.submit`.
          if (!checkName(name, group, hasOptions ? '.options' : '.submit')) return skip()
          const full = `${group !== undefined ? `${group}.` : ''}${name}`
          for (const [key, reason] of rejectedUrls) {
            report(
              'options_url_rejected',
              `Form "${full}": data-tool-options-url of field "${key}" ignored: ${reason}`,
              `${full}.options`,
            )
          }
          if (dev) {
            for (const sk of s.skipped) {
              if (sk.reason === 'read-only') continue
              if (sk.reason.startsWith('pattern dropped:')) {
                report(
                  'schema_conversion_failed',
                  `Form "${full}": the pattern of field "${sk.path}" was dropped (${sk.reason.slice(17).trim()})`,
                  `${full}.fill`,
                )
              } else {
                report(
                  'invalid_name',
                  `Form "${full}": field "${cap(sk.path, 200)}" skipped (${sk.reason})`,
                  `${full}.fill`,
                )
              }
            }
          }
          const submitHints: ToolHints = autosubmit
            ? { untrustedContent: true }
            : destructive
              ? { destructive: true, untrustedContent: true }
              : { consequential: true, untrustedContent: true }
          const adapter = domFormAdapter(form)
          const handle = guarded(`${full}.fill`, () =>
            createFormTools(tm, adapter, {
              name,
              description,
              input: fromJsonSchema(s.validationSchema),
              jsonSchema: s.schema,
              files: s.files,
              origin,
              // `<name>.options` has no native counterpart: it never gets a nativeName.
              ...(origin === 'native-form' ? { nativeName: { fill: name, submit: name } } : {}),
              hints: { fill: { untrustedContent: true }, submit: submitHints },
              ...(hasOptions ? { options } : {}),
              ...(confirmText
                ? { submitSummary: () => cap(confirmText, MAX_CONFIRM_SUMMARY) }
                : {}),
              ...(group !== undefined ? { scope: scopeFor(group)! } : {}),
            }),
          )
          if (!handle || tm.info(`${full}.fill`) === undefined) {
            handle?.dispose()
            adapter.dispose()
            return skip()
          }
          return () => {
            handle.dispose()
            adapter.dispose()
          }
        },
      }
    }

    const planSimple = (
      el: Element,
      kind: 'button' | 'table',
      def: (
        name: string,
        description: string,
        full: string,
      ) => ToolDefinition<unknown, unknown> | undefined,
      extra: unknown,
      defaultDescription: (name: string) => string | undefined,
    ): Plan | undefined => {
      const name = (getAttr(el, 'data-tool') ?? '').trim()
      const given = getAttr(el, 'data-tool-description')?.trim()
      const description = given ? given : defaultDescription(name)
      const group = groupOf(el, root)
      const attrs = [
        'data-tool-readonly',
        'data-tool-consequential',
        'data-tool-destructive',
        'data-tool-confirm',
        'type',
        'form',
      ].map((a) => getAttr(el, a))
      const signature = JSON.stringify({ kind, name, description, group, attrs, extra })
      return {
        signature,
        build: () => {
          if (description === undefined) {
            // I2: never invent a description from page text; reported once per change, dev only.
            if (dev) {
              report(
                'invalid_name',
                `DOM ${kind} tool "${cap(name, 200)}" skipped: it has no data-tool-description ` +
                  `attribute`,
              )
            }
            return skip()
          }
          if (!checkName(name, group, '')) return skip()
          const full = `${group !== undefined ? `${group}.` : ''}${name}`
          const tool = def(name, cap(description, MAX_TOOL_DESCRIPTION), full)
          if (!tool) return skip()
          const scope = scopeFor(group)
          const reg = guarded(full, () => tm.register(tool, scope ? { scope } : undefined))
          return reg ? () => reg.dispose() : skip()
        },
      }
    }

    const planButton = (button: Element): Plan | undefined => {
      if (!isToolButton(button)) return undefined
      const b = button
      return planSimple(
        b,
        'button',
        (name, description, full) => buttonToolDefinition(b, name, description, full),
        // The form owner decides whether the button submits (consequential).
        { submits: submitsForm(b), type: b.type },
        // I2: the description comes from `data-tool-description` only (never the button text).
        () => undefined,
      )
    }

    const planTable = (table: HTMLTableElement): Plan | undefined => {
      const rejected: Array<[string, string]> = []
      const columns = tableColumns(table, (n, reason) => rejected.push([n, reason]))
      if (columns.length === 0) return undefined
      return planSimple(
        table,
        'table',
        (name, description) => {
          for (const [n, reason] of rejected) {
            report(
              'invalid_name',
              `Table "${name}": column "${cap(n, 200)}" skipped (${reason})`,
              name,
            )
          }
          return tableToolDefinition(table, name, description, columns) as ToolDefinition<
            unknown,
            unknown
          >
        },
        { columns, rejected },
        (name) => `The "${name}" table.`,
      )
    }

    const rescan = (): void => {
      if (disposed) return
      const found = collect(root)
      const plans = new Map<Element, Plan>()
      const add = (el: Element, plan: Plan | undefined): void => {
        if (plan) plans.set(el, plan)
      }
      for (const form of found.forms)
        add(
          form,
          guarded('form', () => planForm(form)),
        )
      for (const button of found.buttons)
        add(
          button,
          guarded('button', () => planButton(button)),
        )
      for (const table of found.tables)
        add(
          table,
          guarded('table', () => planTable(table)),
        )
      // Dispose removed or changed tools first, so a name that moved between elements is free.
      for (const [el, reg] of [...live]) {
        if (plans.get(el)?.signature === reg.signature) continue
        live.delete(el)
        guarded('dispose', () => reg.dispose())
      }
      for (const [el, plan] of plans) {
        if (live.has(el)) continue
        const dispose = guarded('build', () => plan.build()) ?? skip()
        live.set(el, { signature: plan.signature, dispose })
      }
      if (observer) {
        for (const sr of found.shadowRoots) {
          if (observed.has(sr)) continue
          observed.add(sr)
          observer.observe(sr, OBSERVE)
        }
      }
    }

    const schedule = (): void => {
      if (disposed || frame) return
      const run = (): void => {
        frame = undefined
        rescan()
      }
      if (typeof requestAnimationFrame === 'function') {
        const id = requestAnimationFrame(run)
        frame = { cancel: () => cancelAnimationFrame(id) }
      } else {
        const id = setTimeout(run, 16)
        frame = { cancel: () => clearTimeout(id) }
      }
    }

    const observer =
      opts.observe !== false && typeof MutationObserver === 'function'
        ? new MutationObserver((records) => {
            if (records.some(isRelevantMutation)) schedule()
          })
        : undefined
    if (observer) {
      observed.add(root)
      observer.observe(root, OBSERVE)
    }
    rescan()

    return () => {
      if (disposed) return
      disposed = true
      observer?.disconnect()
      frame?.cancel()
      frame = undefined
      for (const reg of live.values()) guarded('dispose', () => reg.dispose())
      live.clear()
      for (const scope of groups.values()) scope.dispose()
      groups.clear()
    }
  }
}

/** Schema keys whose value maps names to subschemas (the names themselves are not keywords). */
const SCHEMA_MAPS = new Set(['properties', 'patternProperties', '$defs', 'definitions'])

/**
 * A copy of `schema` without `default` keywords (for change signatures only). Property names
 * called `default` are kept.
 */
function withoutDefaults(schema: unknown, depth = 0): unknown {
  if (depth > 64 || typeof schema !== 'object' || schema === null) return schema
  if (Array.isArray(schema)) return schema.map((s) => withoutDefaults(s, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'default') continue
    if (SCHEMA_MAPS.has(key) && typeof value === 'object' && value !== null) {
      const map: Record<string, unknown> = {}
      for (const [name, sub] of Object.entries(value as Record<string, unknown>)) {
        Object.defineProperty(map, name, {
          value: withoutDefaults(sub, depth + 1),
          enumerable: true,
        })
      }
      Object.defineProperty(out, key, { value: map, enumerable: true })
    } else {
      Object.defineProperty(out, key, {
        value: withoutDefaults(value, depth + 1),
        enumerable: true,
      })
    }
  }
  return out
}
