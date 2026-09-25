import { CONFIRM_SNAPSHOT, type ConfirmSnapshotHook } from '../confirm-snapshot.js'
import type { FileFieldSpec } from '../files.js'
import { createFormTools } from '../forms/form-tools.js'
import { optionsToolDefinition } from '../forms/options.js'
import { deepEqual, isPlainObject, isSafePath, setPath, snapshotValue } from '../forms/paths.js'
import {
  createIssueReader,
  emitInteraction,
  fieldElement,
  firstFormOwner,
  redactValues,
  safeFields,
  sensitivePathsOf,
  subscribeInteractions,
} from '../forms/hooks.js'
import type { FormAdapter, FormToolOptions, OptionsProvider } from '../forms/types.js'
import { fromJsonSchema } from '../json-schema/from-json-schema.js'
import {
  createToolmark,
  emitEvent,
  registryState,
  type Registration,
  type RegistryState,
  type Toolmark,
} from '../registry.js'
import {
  errorResult,
  invalid,
  ok,
  refuse,
  type FieldChange,
  type ToolIssue,
  type ToolResult,
} from '../result.js'
import { validateInput } from '../schema.js'
import type { Scope } from '../scope.js'
import type { StandardSchemaV1 } from '../standard-schema.js'
import type { AnchorSpec, JsonSchema, ToolContext, ToolDefinition, ToolState } from '../tool.js'

/** One step of a wizard ({@link createWizardTools}, spec §8.2). */
export interface WizardStep {
  /**
   * Step name: the key of the step's slice in the wizard data and the prefix of its paths in
   * results (`<step>.<path>`). `A–Z a–z 0–9 _ -`, 1–64 characters, unique within the wizard.
   */
  name: string
  /** User-facing title of the step (listed in the `fill` description). */
  title?: string
  /** Full schema of the step's values (validated on `fill` and before `submit`). */
  input: StandardSchemaV1
  /** JSON Schema override for the step's values. */
  jsonSchema?: JsonSchema
  /** File fields of the step, as {@link FormToolOptions.files}. */
  files?: Record<string, FileFieldSpec>
  /**
   * Async option lookups of the step, as {@link FormToolOptions.options}; the wizard's
   * `<name>.options` tool lists them as `<step>.<path>`.
   */
  options?: Record<string, OptionsProvider>
  /**
   * Dot paths (within the step) whose values are always redacted (spec §14), including in the
   * wizard's `state()`; published as `<step>.<path>` in `tm.info(name).sensitivePaths`.
   */
  sensitive?: string[]
}

/** Options for {@link createWizardTools} (spec §8.2, D25). */
export interface WizardToolOptions {
  /** Tool name prefix: registers `<name>.fill`, `<name>.goTo`, `<name>.submit` (+ `.options`). */
  name: string
  /** LLM-facing description of the wizard. */
  description: string
  /** User-facing title (used in the submit confirmation summary). */
  title?: string
  /** The steps, in order. Empty or duplicate names → `wizard_misconfigured`. */
  steps: WizardStep[]
  /** The parent's source of truth: one values object per step name. */
  getData(): Record<string, Record<string, unknown>>
  /** Replaces the parent data (called at most once per `fill` / undo). */
  setData(next: Record<string, Record<string, unknown>>): void
  /** Name of the current step. */
  getCurrent(): string
  /** Navigates to a step (`<name>.goTo`). */
  goTo(step: string): void
  /**
   * The mounted form of the current step, if any. When present, the current step is read from it
   * and written through it (dirty-aware), so the visible form updates and keeps the user's edits.
   */
  currentAdapter?: () => FormAdapter | undefined
  /**
   * Called with the current step's merged values after a `fill` (or undo) wrote them into parent
   * data because no step adapter is mounted, so the app can reset the visible step form.
   */
  resetCurrent?: (values: Record<string, unknown>) => void
  /** Submits the wizard (`<name>.submit`, consequential, after every step validated). */
  submit(): Promise<ToolResult<unknown>>
  /** User-facing submit confirmation summary (default `"Submit <title ?? name>"`). */
  submitSummary?: (data: Record<string, Record<string, unknown>>) => string
}

/** Options for {@link createStepwiseWizardTools} (the stepwise fallback, spec §8.2). */
export interface StepwiseWizardOptions {
  /** Tool name prefix. */
  name: string
  /** LLM-facing description of the wizard. */
  description: string
  /** User-facing title (used in the submit confirmation summary). */
  title?: string
  /** The mounted form of the current step (`<name>.step.fill` writes through it). */
  currentAdapter: () => FormAdapter | undefined
  /** The current step: its name and full schema (read on creation and by `refresh()`). */
  currentStep: () => { name: string; input: StandardSchemaV1; jsonSchema?: JsonSchema }
  /** Validates the current step and moves forward; its result is returned to the agent. */
  next(): Promise<ToolResult<unknown>>
  /** Moves back one step. */
  previous(): void
  /** Submits the wizard (`<name>.submit`, consequential). */
  submit(): Promise<ToolResult<unknown>>
  /** User-facing submit confirmation summary (default `"Submit <title ?? name>"`). */
  submitSummary?: () => string
}

type Data = Record<string, Record<string, unknown>>
interface FillInput {
  values: Record<string, unknown>
  overwrite?: boolean
}
interface FillData {
  changes: FieldChange[]
  skipped: string[]
}
type FillTool = ToolDefinition<FillInput, unknown>

const STEP_NAME = /^[A-Za-z0-9_-]{1,64}$/

const define = (container: object, key: string, value: unknown): void => {
  Object.defineProperty(container, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  })
}

const byPath = (a: { path: string }, b: { path: string }): number =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0

const prefixed = (step: string, path: string): string => (path === '' ? step : `${step}.${path}`)

/**
 * Builds a step's form fill in a private registry (M2 T4): `createFormTools` on a throwaway
 * registry that shares the real registry's settings (development mode, JSON Schema converter,
 * files), so the wizard reuses the form-fill core unchanged (fail-closed paths, forbidden keys,
 * duplicate paths, node budget, array ops, files, redaction, undo) without exposing per-step
 * tools. Errors the private registry reports after its creation are forwarded to the real one.
 * @returns The captured `fill` definition and a disposer, or `undefined` when the form registered
 * nothing (a production misconfiguration, already reported).
 */
function privateFill(
  state: RegistryState,
  adapter: FormAdapter,
  formOpts: FormToolOptions<Record<string, unknown>>,
): { fill: FillTool; dispose(): void } | undefined {
  let forward = false
  const shadow = createToolmark({
    dev: state.dev,
    __environment: 'browser',
    budget: Number.POSITIVE_INFINITY,
    // Its tools are never exposed: a confirm handler keeps it quiet about inline confirmation.
    confirm: () => Promise.resolve({ approved: false }),
    ...(state.options.jsonSchema !== undefined ? { jsonSchema: state.options.jsonSchema } : {}),
    // Re-validated here: a production misconfiguration was already reported by the real registry.
    ...(state.options.files !== undefined ? { files: state.options.files } : {}),
    onError: (e) => {
      if (forward) state.report(e)
    },
  })
  forward = true
  const handle = createFormTools(shadow, adapter, formOpts)
  const entry = registryState(shadow)?.entries.get(`${formOpts.name}.fill`)
  if (!entry) {
    handle.dispose()
    return undefined
  }
  return { fill: entry.tool as FillTool, dispose: () => handle.dispose() }
}

/** Decodes a JSON Pointer token (`~1` → `/`, `~0` → `~`, then percent-decoding). */
function decodeToken(token: string): string {
  const raw = token.replaceAll('~1', '/').replaceAll('~0', '~')
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

const encodeToken = (name: string): string => name.replaceAll('~', '~0').replaceAll('/', '~1')

/**
 * The step's fill `values` schema with its definitions moved to the wizard root under
 * `<step>.<name>` (`definitions` entries under `<step>.definitions.<name>`), every local `$ref`
 * rewritten accordingly, so steps with same-named definitions cannot collide.
 *
 * When a step declares both `$defs` and `definitions`, a `$defs` entry literally named e.g.
 * `"definitions.x"` would otherwise land on the same renamed key as a `definitions` entry named
 * `"x"` (`<step>.definitions.x`), silently clobbering one; both kinds are then given their own
 * distinct, non-overlapping prefix (`<step>.defs.<name>` / `<step>.definitions.<name>`) so no
 * name can collide across them. A step using only one of the two keeps the plain `<step>.<name>`
 * form (unchanged, since same-kind names are already unique object keys).
 */
function namespaceStepSchema(
  step: string,
  fillSchema: JsonSchema | undefined,
): { values: unknown; defs: Record<string, unknown> } {
  const hasBoth = isPlainObject(fillSchema?.$defs) && isPlainObject(fillSchema?.definitions)
  const rename = (kind: string, name: string): string =>
    `${step}.${kind === 'definitions' ? 'definitions.' : hasBoth ? 'defs.' : ''}${name}`
  const rewrite = (node: unknown, depth: number): unknown => {
    if (depth > 64) return node
    if (Array.isArray(node)) return node.map((n) => rewrite(n, depth + 1))
    if (typeof node !== 'object' || node === null) return node
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(node)) {
      // `const`/`default`/`enum` hold literal data, not schema: a `$ref`-shaped property inside
      // one of them is a data value, never a schema reference, and must pass through untouched.
      if (key === 'const' || key === 'default' || key === 'enum') {
        define(out, key, value)
        continue
      }
      const m =
        key === '$ref' && typeof value === 'string'
          ? /^#\/(\$defs|definitions)\/([^/]+)(.*)$/.exec(value)
          : null
      define(
        out,
        key,
        m
          ? `#/$defs/${encodeToken(rename(m[1]!, decodeToken(m[2]!)))}${m[3]!}`
          : rewrite(value, depth + 1),
      )
    }
    return out
  }
  const props = isPlainObject(fillSchema?.properties) ? fillSchema.properties : {}
  const values = rewrite(Object.hasOwn(props, 'values') ? props.values : {}, 0)
  const defs: Record<string, unknown> = {}
  for (const kind of ['$defs', 'definitions'] as const) {
    const d = fillSchema?.[kind]
    if (!isPlainObject(d)) continue
    for (const [name, def] of Object.entries(d)) define(defs, rename(kind, name), rewrite(def, 0))
  }
  return { values, defs }
}

/**
 * The adapter a step's private fill writes through (M2 T4). Every write is staged: `getValues()`
 * is the step's base (the mounted form of the current step, else its parent-data slice) with the
 * staged writes applied, and nothing reaches the app until the wizard commits, so an invalid step
 * leaves every step unwritten.
 */
class StepPort implements FormAdapter {
  pending = new Map<string, unknown>()
  live: FormAdapter | undefined
  current = false
  readonly name: string
  readonly #opts: WizardToolOptions

  constructor(name: string, opts: WizardToolOptions) {
    this.name = name
    this.#opts = opts
  }

  /** Starts a staged operation: resolves the current step and its mounted form now. */
  begin(): void {
    this.pending = new Map()
    this.current = this.#opts.getCurrent() === this.name
    this.live = this.current ? this.#opts.currentAdapter?.() : undefined
  }

  base(): Record<string, unknown> {
    if (this.live) return this.live.getValues()
    return dataSlice(this.#opts.getData(), this.name)
  }

  getValues(): Record<string, unknown> {
    let values = this.base()
    for (const [path, v] of this.pending) values = setPath(values, path, v === null ? undefined : v)
    return values
  }

  setValues(values: Record<string, unknown>): void {
    for (const key of Object.keys(values)) this.pending.set(key, values[key])
  }

  dirtyPaths(): string[] {
    return this.live?.dirtyPaths() ?? []
  }

  submit(): Promise<ToolResult<unknown>> {
    return Promise.resolve(errorResult('Steps are submitted through the wizard'))
  }

  fields() {
    return this.live?.fields() ?? []
  }

  /** The staged writes as a flat `{ path: value }` object. */
  staged(): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const [path, v] of this.pending) define(out, path, v)
    return out
  }
}

/** The step's slice of the parent data (own property, plain object), else `{}`. */
function dataSlice(data: unknown, step: string): Record<string, unknown> {
  if (!isPlainObject(data) || !Object.hasOwn(data, step)) return {}
  const slice = data[step]
  return isPlainObject(slice) ? slice : {}
}

/** Problems with a wizard's step list (empty, invalid or duplicate names). */
function stepProblems(steps: unknown): string[] {
  if (!Array.isArray(steps) || steps.length === 0) return ['it has no steps']
  const problems: string[] = []
  const seen = new Set<string>()
  for (const step of steps as unknown[]) {
    const name = isPlainObject(step) ? step.name : undefined
    if (typeof name !== 'string' || !STEP_NAME.test(name) || !isSafePath(name)) {
      problems.push(`step name ${JSON.stringify(name)} is invalid (use A-Z a-z 0-9 _ -)`)
    } else if (seen.has(name)) {
      problems.push(`step name "${name}" is used more than once`)
    } else {
      seen.add(name)
    }
  }
  return problems
}

/** Whether `reg` is live (production reports a failed registration and returns an inert one). */
const isLive = (state: RegistryState, reg: Registration): boolean =>
  state.entries.get(reg.name)?.registration === reg

/** Any tool definition, as the registry stores it. */
type AnyTool = ToolDefinition<unknown, unknown>

/**
 * Erases a definition's input type for {@link registerAll}; the optional confirm-snapshot hook is
 * carried under its symbol (as `createFormTools`' submit does).
 */
const asTool = <I, O>(
  def: ToolDefinition<I, O> & { [CONFIRM_SNAPSHOT]?: ConfirmSnapshotHook },
): AnyTool => def as unknown as AnyTool

/**
 * Registers every definition or none (a failed registration disposes the others; a throw is
 * rethrown after cleanup).
 */
function registerAll(
  tm: Toolmark,
  state: RegistryState,
  defs: AnyTool[],
  scope: Scope | undefined,
): Registration[] | undefined {
  const regs: Registration[] = []
  const undo = (): void => {
    for (const r of regs) r.dispose()
  }
  try {
    for (const def of defs) {
      const reg = tm.register(def, scope ? { scope } : undefined)
      regs.push(reg)
      if (!isLive(state, reg)) {
        undo()
        return undefined
      }
    }
  } catch (e) {
    undo()
    throw e
  }
  return regs
}

/** Validator for tools that take no input (`undefined` or `{}`), then runs `then`. */
function noInput<T>(
  then: () => StandardSchemaV1.Result<T> | Promise<StandardSchemaV1.Result<T>>,
): StandardSchemaV1<unknown, T> {
  return {
    '~standard': {
      version: 1,
      vendor: 'toolmark',
      validate(value) {
        const empty =
          value === undefined || (isPlainObject(value) && Object.keys(value).length === 0)
        return empty ? then() : { issues: [{ message: 'This tool takes no input', path: [] }] }
      },
    },
  }
}

const NO_INPUT_SCHEMA: JsonSchema = { type: 'object', properties: {}, additionalProperties: false }

/**
 * Follows the current step's mounted form for interaction events (spec §13). There is no
 * step-change notification, so `sync()` re-subscribes whenever it sees a different current step or
 * form; the wizard calls it on creation and from every tour hook (`state`, `anchors`) and `fill`.
 */
function interactionTracker(
  tm: Toolmark,
  current: () => { step: string; adapter: FormAdapter | undefined },
  emit: (step: string, e: unknown) => void,
  tool: () => string,
): { sync(): void; dispose(): void } {
  let watched: { step: string; adapter: FormAdapter | undefined; off(): void } | undefined
  let disposed = false
  return {
    sync() {
      if (disposed) return
      let now: { step: string; adapter: FormAdapter | undefined }
      try {
        now = current()
      } catch {
        return
      }
      if (watched && watched.step === now.step && watched.adapter === now.adapter) return
      watched?.off()
      const step = now.step
      let live = true
      const off = subscribeInteractions(tm, now.adapter, tool(), (e) => {
        if (live && !disposed) emit(step, e)
      })
      watched = {
        step,
        adapter: now.adapter,
        off() {
          live = false
          off()
        },
      }
    },
    dispose() {
      disposed = true
      watched?.off()
      watched = undefined
    },
  }
}

/**
 * Registers the tools of a wizard whose data lives in the parent (spec §8.2, D25):
 *
 * - `<name>.fill` — `{ steps: { <step>: partial values }, overwrite? }`. Each step is filled with the
 *   form-fill semantics of {@link createFormTools} (merge-based validation against the step schema,
 *   array ops, files, `null` clears, redaction, user-edited fields skipped unless `overwrite`).
 *   The current step is read from and written through `currentAdapter()` when it returns a form;
 *   otherwise it is written into parent data and `resetCurrent(values)` is called (with neither,
 *   the `error` event `wizard_current_step_unsynced` fires once). Other steps are written with one
 *   `setData` call. Any invalid step → `invalid` (paths `<step>.<path>`) and nothing is written;
 *   otherwise `ok({ changes, skipped })` with `<step>.<path>` paths. Undoable: `tm.undo(callId)`
 *   restores every touched step, through the form of the step that is current at undo time,
 *   otherwise through `setData`.
 * - `<name>.goTo` — `{ step }` → `goTo(step)` → `ok({ step })`.
 * - `<name>.submit` — `consequential`. Every step's full schema is validated first (the current
 *   step from its mounted form); any issue → `invalid` and no confirmation is created. A
 *   confirmation approved after the wizard's data changed is refused `stale`.
 * - `<name>.options` — when any step declares `options`; `field` is `<step>.<path>`.
 *
 * Tour hooks (spec §13): `<name>.fill` and `<name>.submit` expose `state()` → `{ values, issues,
 * step }` (`values` keyed by step — the current step from its mounted form, the others from
 * `getData()` — with sensitive paths redacted; `issues` of the current step as `<step>.<path>`;
 * `step` = `getCurrent()`) and `sensitivePaths()` (`<step>.<path>`: each step's `sensitive` plus the
 * current step form's sensitive fields). `<name>.fill` anchors `resolve('<step>.<path>')` to the
 * field's element only while `<step>` is current (else `null`); both anchor to the current step's
 * form. Interaction events of the current step's form are emitted as `<name>.fill` with
 * `param: '<step>.<path>'` (`submit` → `param: '<step>'`); the wizard follows the current form
 * when it is created and on every `state`/anchor read and `fill`.
 *
 * Empty or duplicate step names → `wizard_misconfigured` (development: throws `ToolmarkError`;
 * production: `error` event, nothing registered). Under SSR nothing is registered.
 * @param tm - The registry.
 * @param opts - Wizard options plus an optional target `scope`.
 * @returns A handle whose `dispose()` removes the wizard's tools.
 */
export function createWizardTools(
  tm: Toolmark,
  opts: WizardToolOptions & { scope?: Scope },
): { dispose(): void } {
  const state = registryState(tm)
  const inert = { dispose() {} }
  if (!state?.browser) return inert
  const problems = stepProblems(opts.steps)
  if (problems.length > 0) {
    state.fail(
      'wizard_misconfigured',
      `Wizard "${opts.name}": ${problems.join('; ')}`,
      `${opts.name}.fill`,
    )
    return inert
  }

  interface StepRuntime {
    step: WizardStep
    port: StepPort
    fill: FillTool
  }
  const runtimes: StepRuntime[] = []
  const privateForms: { dispose(): void }[] = []
  const disposePrivate = (): void => {
    for (const f of privateForms) f.dispose()
  }
  try {
    for (const step of opts.steps) {
      const port = new StepPort(step.name, opts)
      const built = privateFill(state, port, {
        name: opts.name,
        description: opts.description,
        input: step.input as StandardSchemaV1<unknown, Record<string, unknown>>,
        ...(step.jsonSchema !== undefined ? { jsonSchema: step.jsonSchema } : {}),
        ...(step.files !== undefined ? { files: step.files } : {}),
        ...(step.options !== undefined ? { options: step.options } : {}),
        ...(step.sensitive !== undefined ? { sensitive: step.sensitive } : {}),
      })
      if (!built) {
        disposePrivate()
        return inert
      }
      privateForms.push(built)
      runtimes.push({ step, port, fill: built.fill })
    }
  } catch (e) {
    disposePrivate()
    throw e
  }
  const byName = new Map(runtimes.map((r) => [r.step.name, r]))
  const names = runtimes.map((r) => r.step.name)
  let fillToolName = `${opts.name}.fill`
  let warnedUnsynced = false

  /**
   * Writes the staged values: one `setData`, then the mounted form, then `resetCurrent`. If a
   * mounted form's `setValues` or `resetCurrent` throws after `setData` already ran, the previous
   * parent data is restored (`setData(prev)`) and the error is rethrown, so a throwing step leaves
   * parent data unchanged (the call yields `error` "Tool failed" and nothing is left to undo).
   */
  const commit = (ports: StepPort[], source: 'agent' | 'undo'): void => {
    const written = ports.filter((p) => p.pending.size > 0)
    const dataPorts = written.filter((p) => !p.live)
    const prev = opts.getData()
    let next: Data | undefined
    if (dataPorts.length > 0) {
      next = isPlainObject(prev) ? { ...prev } : {}
      for (const p of dataPorts) define(next, p.name, p.getValues())
      opts.setData(next)
    }
    try {
      for (const p of written) if (p.live) p.live.setValues(p.staged(), { source })
      for (const p of dataPorts) {
        if (!p.current) continue
        if (opts.resetCurrent) {
          opts.resetCurrent(dataSlice(next, p.name))
        } else if (!warnedUnsynced) {
          warnedUnsynced = true
          emitEvent(tm, 'error', {
            code: 'wizard_current_step_unsynced',
            message:
              `Wizard "${opts.name}" wrote its current step "${p.name}" into parent data, but has ` +
              `neither currentAdapter nor resetCurrent: the visible step form may show stale values`,
            tool: fillToolName,
          })
        }
      }
    } catch (e) {
      if (dataPorts.length > 0) opts.setData(prev)
      throw e
    }
  }

  async function fill(
    input: { steps: Record<string, unknown>; overwrite?: boolean },
    ctx: ToolContext,
  ) {
    tracker.sync()
    const issues: ToolIssue[] = []
    const work = new Map<StepRuntime, Record<string, unknown>>()
    for (const key of Object.keys(input.steps)) {
      const rt = byName.get(key)
      const values = input.steps[key]
      if (!rt || !Object.hasOwn(input.steps, key)) {
        issues.push({ path: key, message: 'Unknown step' })
      } else if (values === undefined) {
        continue
      } else if (!isPlainObject(values)) {
        issues.push({ path: key, message: 'Expected an object of field values' })
      } else {
        work.set(rt, values)
      }
    }
    if (issues.length > 0) return invalid(issues.sort(byPath))
    const ordered = runtimes.filter((rt) => work.has(rt))
    for (const rt of ordered) rt.port.begin()
    const undos: { rt: StepRuntime; restore: () => unknown }[] = []
    const changes: FieldChange[] = []
    const skipped: string[] = []
    for (const rt of ordered) {
      const stepCtx: ToolContext = {
        ...ctx,
        registerUndo: (restore) => undos.push({ rt, restore }),
      }
      const values = work.get(rt)!
      const r = await rt.fill.run(
        input.overwrite === undefined ? { values } : { values, overwrite: input.overwrite },
        stepCtx,
      )
      if (r.status === 'invalid') {
        for (const i of r.issues)
          issues.push({ path: prefixed(rt.step.name, i.path), message: i.message })
      } else if (r.status !== 'ok') {
        return r // refused (e.g. file_rejected), cancelled or error: nothing is written.
      } else {
        const data = r.data as FillData
        for (const c of data.changes) changes.push({ ...c, path: prefixed(rt.step.name, c.path) })
        for (const p of data.skipped) skipped.push(prefixed(rt.step.name, p))
      }
    }
    if (issues.length > 0) return invalid(issues.sort(byPath))
    commit(
      ordered.map((rt) => rt.port),
      'agent',
    )
    if (undos.length > 0) {
      ctx.registerUndo(async () => {
        const touched = [...new Set(undos.map((u) => u.rt))]
        for (const rt of touched) rt.port.begin()
        const undoChanges: FieldChange[] = []
        const undoSkipped: string[] = []
        for (const u of undos) {
          const r = (await u.restore()) as ToolResult<unknown>
          if (r.status !== 'ok') continue
          const data = r.data as FillData
          for (const c of data.changes) {
            undoChanges.push({ ...c, path: prefixed(u.rt.step.name, c.path) })
          }
          for (const p of data.skipped) undoSkipped.push(prefixed(u.rt.step.name, p))
        }
        commit(
          touched.map((rt) => rt.port),
          'undo',
        )
        return ok({ changes: undoChanges.sort(byPath), skipped: undoSkipped.sort() })
      })
    }
    return ok({ changes: changes.sort(byPath), skipped: skipped.sort() })
  }

  // Fill manifest schema: one stripped step schema per step, definitions namespaced by step.
  const stepSchemas: Record<string, unknown> = {}
  const defs: Record<string, unknown> = {}
  for (const rt of runtimes) {
    const ns = namespaceStepSchema(rt.step.name, rt.fill.jsonSchema)
    define(stepSchemas, rt.step.name, ns.values)
    for (const [k, v] of Object.entries(ns.defs)) define(defs, k, v)
  }
  const fillSchema: JsonSchema = {
    type: 'object',
    properties: {
      steps: { type: 'object', properties: stepSchemas, additionalProperties: false },
      overwrite: { type: 'boolean' },
    },
    required: ['steps'],
  }
  if (Object.keys(defs).length > 0) fillSchema.$defs = defs
  const fillInput: StandardSchemaV1<
    unknown,
    { steps: Record<string, unknown>; overwrite?: boolean }
  > = {
    '~standard': {
      version: 1,
      vendor: 'toolmark',
      validate(value) {
        if (!isPlainObject(value)) return { issues: [{ message: 'Expected an object' }] }
        const issues: { message: string; path: PropertyKey[] }[] = []
        for (const key of Object.keys(value)) {
          if (key !== 'steps' && key !== 'overwrite')
            issues.push({ message: 'Unknown field', path: [key] })
        }
        if (!isPlainObject(value.steps)) {
          issues.push({ message: 'Expected an object of step values', path: ['steps'] })
        }
        if (value.overwrite !== undefined && typeof value.overwrite !== 'boolean') {
          issues.push({ message: 'Expected a boolean', path: ['overwrite'] })
        }
        if (issues.length > 0) return { issues }
        const out: { steps: Record<string, unknown>; overwrite?: boolean } = {
          steps: value.steps as Record<string, unknown>,
        }
        if (typeof value.overwrite === 'boolean') out.overwrite = value.overwrite
        return { value: out }
      },
    },
  }
  const stepList = runtimes
    .map((rt) =>
      rt.step.title !== undefined ? `${rt.step.name} (${rt.step.title})` : rt.step.name,
    )
    .join(', ')
  const hasFiles = runtimes.some((rt) => rt.step.files && Object.keys(rt.step.files).length > 0)
  const title = opts.title !== undefined ? { title: opts.title } : {}

  /** Current values of a step: its mounted form when it is current, else its parent-data slice. */
  const currentValues = (step: string): Record<string, unknown> => {
    const live = opts.getCurrent() === step ? opts.currentAdapter?.() : undefined
    return live ? live.getValues() : dataSlice(opts.getData(), step)
  }
  // Tour hooks (spec §13, §14; M3 T2). Redaction is owned here: `state()` redacts every path of
  // the sensitive rule (each step's `sensitive`, plus the current step form's sensitive fields),
  // published as `<step>.<path>` through `sensitivePaths()` / `tm.info`.
  const mountedForm = (step: string): FormAdapter | undefined =>
    opts.getCurrent() === step ? opts.currentAdapter?.() : undefined
  const stepSensitive = (rt: StepRuntime): string[] =>
    sensitivePathsOf(rt.step.sensitive, safeFields(mountedForm(rt.step.name)))
  const wizardSensitive = (): string[] =>
    runtimes.flatMap((rt) => stepSensitive(rt).map((p) => prefixed(rt.step.name, p)))
  const issueReaders = new Map(runtimes.map((rt) => [rt, createIssueReader(() => rt.step.input)]))
  const tracker = interactionTracker(
    tm,
    () => {
      const step = opts.getCurrent()
      return { step, adapter: byName.has(step) ? opts.currentAdapter?.() : undefined }
    },
    (step, e) => {
      emitInteraction(tm, e, { fillTool: fillToolName, mapPath: (p) => prefixed(step, p) })
    },
    () => fillToolName,
  )
  const wizardState = (): ToolState<unknown> => {
    tracker.sync()
    const step = opts.getCurrent()
    const values: Data = {}
    for (const rt of runtimes) {
      define(values, rt.step.name, redactValues(currentValues(rt.step.name), stepSensitive(rt)))
    }
    const rt = byName.get(step)
    const issues = rt
      ? issueReaders.get(rt)!(currentValues(step)).map((i) => ({
          path: prefixed(step, i.path),
          message: i.message,
        }))
      : []
    return { values, issues, step }
  }
  /** `<step>.<path>` → that field's element, only while `<step>` is current (`<step>` → its form). */
  const wizardAnchors: AnchorSpec = {
    element: () => {
      tracker.sync()
      return firstFormOwner(safeFields(mountedForm(opts.getCurrent())))
    },
    resolve: (param) => {
      tracker.sync()
      const dot = param.indexOf('.')
      const step = dot < 0 ? param : param.slice(0, dot)
      const fields = safeFields(mountedForm(step))
      return dot < 0 ? firstFormOwner(fields) : fieldElement(fields, param.slice(dot + 1))
    },
  }
  const wizardHooks: Pick<AnyTool, 'state' | 'sensitivePaths'> = {
    state: wizardState,
    sensitivePaths: wizardSensitive,
  }

  const submitInput = noInput<Record<string, never>>(async () => {
    const issues: { message: string; path: PropertyKey[] }[] = []
    for (const rt of runtimes) {
      const r = await validateInput(rt.step.input, currentValues(rt.step.name))
      if (r.ok) continue
      for (const i of r.issues) {
        issues.push({
          message: i.message,
          path: [rt.step.name, ...(i.path === '' ? [] : [i.path])],
        })
      }
    }
    return issues.length > 0 ? { issues } : { value: {} }
  })
  const snapshot = (): unknown =>
    snapshotValue({
      data: opts.getData(),
      current: opts.getCurrent(),
      live: opts.currentAdapter?.()?.getValues(),
    })
  const snapshotHook: ConfirmSnapshotHook = {
    take: snapshot,
    changed: (before) => !deepEqual(snapshot(), before),
  }

  const defsToRegister: AnyTool[] = [
    {
      ...asTool({
        name: `${opts.name}.fill`,
        ...title,
        description:
          `${opts.description} Fill wizard steps: pass "steps" as { <step>: partial values } for ` +
          `any of the steps ${stepList} (null clears a field). Fields the user edited are skipped ` +
          `unless "overwrite" is true.` +
          (hasFiles ? ' File fields take { "ref": "..." } or { "url": "..." }.' : ''),
        input: fillInput,
        jsonSchema: fillSchema,
        run: fill,
      }),
      anchors: wizardAnchors,
      ...wizardHooks,
    },
    asTool({
      name: `${opts.name}.goTo`,
      ...title,
      description: `${opts.description} Go to a wizard step.`,
      input: fromJsonSchema<{ step: string }>({
        type: 'object',
        properties: { step: { type: 'string', enum: names, description: 'Step name.' } },
        required: ['step'],
        additionalProperties: false,
      }),
      run: ({ step }: { step: string }) => {
        opts.goTo(step)
        return ok({ step })
      },
    }),
    {
      ...asTool({
        name: `${opts.name}.submit`,
        ...title,
        description: `${opts.description} Submit the wizard (every step is validated first).`,
        hints: { consequential: true },
        input: submitInput,
        jsonSchema: NO_INPUT_SCHEMA,
        summary: () => opts.submitSummary?.(opts.getData()) ?? `Submit ${opts.title ?? opts.name}`,
        run: () => opts.submit(),
        [CONFIRM_SNAPSHOT]: snapshotHook,
      }),
      anchors: { element: wizardAnchors.element! },
      ...wizardHooks,
    },
  ]
  const providers: Record<string, OptionsProvider> = {}
  for (const rt of runtimes) {
    for (const [key, provider] of Object.entries(rt.step.options ?? {})) {
      define(providers, `${rt.step.name}.${key}`, provider)
    }
  }
  if (Object.keys(providers).length > 0) {
    defsToRegister.push(asTool(optionsToolDefinition(tm, opts.name, opts.description, providers)))
  }
  let regs: Registration[] | undefined
  try {
    regs = registerAll(tm, state, defsToRegister, opts.scope)
  } catch (e) {
    disposePrivate()
    throw e
  }
  if (!regs) {
    disposePrivate()
    return inert
  }
  fillToolName = regs[0]!.name
  tracker.sync()
  return {
    dispose() {
      tracker.dispose()
      for (const r of regs) r.dispose()
      disposePrivate()
    },
  }
}

/**
 * Registers the stepwise fallback of a wizard that cannot expose parent state (spec §8.2): every
 * tool carries `mode: 'stepwise'` in the manifest.
 *
 * - `<name>.step.fill` — the form fill of the current step's mounted form (as
 *   {@link createFormTools}' `fill`), with the current step's schema; its description ends with
 *   `" (current step: <step>)"`. No mounted form → `refused` `not_allowed`.
 * - `<name>.next` — calls `next()` and returns the app's result.
 * - `<name>.previous` — calls `previous()` → `ok({ step })` (the new current step).
 * - `<name>.submit` — `consequential`; refused `stale` when the step form changed after the
 *   confirmation was requested.
 *
 * `refresh()` re-registers `<name>.step.fill` for the current step (one revision bump) and is a
 * no-op while the current step's name is unchanged; call it whenever the step changes.
 *
 * Tour hooks (spec §13): `<name>.step.fill` anchors, `state()` and `sensitivePaths()` are those of
 * the current step's mounted form (as {@link createFormTools}, plain paths), and its user
 * interactions are emitted as `<name>.step.fill` events (followed on every anchor/state read and
 * `refresh()`).
 * @param tm - The registry.
 * @param opts - Stepwise wizard options plus an optional target `scope`.
 * @returns A handle: `dispose()` removes the tools, `refresh()` follows the current step.
 */
export function createStepwiseWizardTools(
  tm: Toolmark,
  opts: StepwiseWizardOptions & { scope?: Scope },
): { dispose(): void; refresh(): void } {
  const state = registryState(tm)
  if (!state?.browser) return { dispose() {}, refresh() {} }
  const title = opts.title !== undefined ? { title: opts.title } : {}
  const port: FormAdapter = {
    getValues: () => opts.currentAdapter()?.getValues() ?? {},
    setValues: (values, o) => opts.currentAdapter()?.setValues(values, o),
    dirtyPaths: () => opts.currentAdapter()?.dirtyPaths() ?? [],
    submit: () => Promise.resolve(errorResult('Use the wizard submit tool')),
    fields: () => opts.currentAdapter()?.fields() ?? [],
  }

  // Interaction events of the current step's form under `<name>.step.fill` (spec §13).
  let stepFillName = `${opts.name}.step.fill`
  const tracker = interactionTracker(
    tm,
    () => ({ step: opts.currentStep().name, adapter: opts.currentAdapter() }),
    (_step, e) => {
      emitInteraction(tm, e, { fillTool: stepFillName })
    },
    () => stepFillName,
  )

  /** Builds the private fill of the current step and its public `step.fill` definition. */
  const build = (): { def: AnyTool; step: string; dispose(): void } | undefined => {
    const step = opts.currentStep()
    const built = privateFill(state, port, {
      name: `${opts.name}.step`,
      description: opts.description,
      input: step.input as StandardSchemaV1<unknown, Record<string, unknown>>,
      ...(step.jsonSchema !== undefined ? { jsonSchema: step.jsonSchema } : {}),
    })
    if (!built) return undefined
    const inner = built.fill
    const def: FillTool = {
      ...inner,
      ...title,
      description: `${inner.description} (current step: ${step.name})`,
      mode: 'stepwise',
      // The current step form's anchors and state (inherited from the private fill over `port`),
      // each read also following the current form for interaction events.
      anchors: {
        element: () => {
          tracker.sync()
          return inner.anchors?.element?.() ?? null
        },
        resolve: (param) => {
          tracker.sync()
          return inner.anchors?.resolve?.(param) ?? null
        },
      },
      state: () => {
        tracker.sync()
        return inner.state!()
      },
      run: (input, ctx) =>
        opts.currentAdapter()
          ? inner.run(input, ctx)
          : refuse('not_allowed', 'No step form is mounted'),
    }
    return { def: asTool(def), step: step.name, dispose: () => built.dispose() }
  }

  const snapshot = (): unknown =>
    snapshotValue({ step: opts.currentStep().name, values: opts.currentAdapter()?.getValues() })
  const snapshotHook: ConfirmSnapshotHook = {
    take: snapshot,
    changed: (before) => !deepEqual(snapshot(), before),
  }
  const first = build()
  if (!first) return { dispose() {}, refresh() {} }
  const others: AnyTool[] = [
    asTool({
      name: `${opts.name}.next`,
      ...title,
      description: `${opts.description} Validate the current step and go to the next one.`,
      mode: 'stepwise',
      run: () => opts.next(),
    }),
    asTool({
      name: `${opts.name}.previous`,
      ...title,
      description: `${opts.description} Go back to the previous step.`,
      mode: 'stepwise',
      run: () => {
        opts.previous()
        return ok({ step: opts.currentStep().name })
      },
    }),
    asTool({
      name: `${opts.name}.submit`,
      ...title,
      description: `${opts.description} Submit the wizard.`,
      hints: { consequential: true },
      mode: 'stepwise',
      summary: () => opts.submitSummary?.() ?? `Submit ${opts.title ?? opts.name}`,
      run: () => opts.submit(),
      [CONFIRM_SNAPSHOT]: snapshotHook,
    }),
  ]
  let regs: Registration[] | undefined
  try {
    regs = registerAll(tm, state, [first.def, ...others], opts.scope)
  } catch (e) {
    first.dispose()
    throw e
  }
  if (!regs) {
    first.dispose()
    return { dispose() {}, refresh() {} }
  }
  const fixed = regs.slice(1)
  let fillReg: Registration | undefined = regs[0]
  stepFillName = regs[0]!.name
  tracker.sync()
  let fillPrivate: { dispose(): void } | undefined = first
  let currentStep = first.step
  let disposed = false

  return {
    dispose() {
      if (disposed) return
      disposed = true
      tracker.dispose()
      fillReg?.dispose()
      fillPrivate?.dispose()
      for (const r of fixed) r.dispose()
    },
    refresh() {
      if (disposed) return
      tracker.sync()
      if (opts.currentStep().name === currentStep) return
      const next = build()
      fillReg?.dispose()
      fillPrivate?.dispose()
      fillReg = undefined
      fillPrivate = undefined
      if (!next) return
      // `currentStep` follows the step only once its registration lands: a failed registration
      // (e.g. a production duplicate-name collision) leaves it unchanged, so the next refresh()
      // for the same target step retries instead of treating it as a no-op.
      const reg = tm.register(next.def, opts.scope ? { scope: opts.scope } : undefined)
      if (!isLive(state, reg)) {
        next.dispose()
        return
      }
      currentStep = next.step
      fillReg = reg
      fillPrivate = next
    },
  }
}
