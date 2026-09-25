import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import {
  createStepwiseWizardTools,
  createWizardTools,
  emitEvent,
  ToolmarkError,
  type FormAdapter,
  type OptionsProvider,
  type StepwiseWizardOptions,
  type ToolResult,
  type WizardStep,
} from '@toolmark/core'
import { useCurrentScope } from './scope.js'
import { useToolmark } from './provider.js'

// Bundlers (webpack, Next.js, esbuild) statically replace `process.env.NODE_ENV`; declaring the
// ambient shape (instead of depending on `@types/node`, which this package doesn't have) lets that
// replacement/dead-code-elimination happen without a real Node `process` at runtime.
declare const process: { env: Record<string, string | undefined> } | undefined

/**
 * @internal Best-effort dev-mode detection with no bundler-specific dependency. Duplicated from
 * `use-tool.ts` (outside this file's ownership for this task): the registry's own `dev` flag
 * (which drives core's identical "throw in dev, event in prod" contract, e.g. `wizard_misconfigured`
 * for an empty/duplicate step list) is a construction-time option with no public getter on
 * `Toolmark`, so this hook-level misconfiguration check (missing `next`/`previous`/`currentAdapter`
 * in stepwise mode, which core never sees) uses the same bundler-environment heuristic `useTool`
 * already relies on for its dev-only churn warning.
 */
function isDevEnvironment(): boolean {
  try {
    const meta = import.meta as unknown as { env?: { DEV?: boolean; MODE?: string } }
    if (meta.env) {
      if (typeof meta.env.DEV === 'boolean') return meta.env.DEV
      if (typeof meta.env.MODE === 'string') return meta.env.MODE !== 'production'
    }
  } catch {
    // Not bundled with a `define`d `import.meta.env`; fall through.
  }
  if (typeof process !== 'undefined' && process.env.NODE_ENV) {
    return process.env.NODE_ENV !== 'production'
  }
  return false
}

/** Options for {@link useWizardTool} (spec §8.2, D25). */
export interface UseWizardToolOptions {
  /**
   * Tool name prefix. Parent-state mode registers `<name>.fill`, `<name>.goTo`, `<name>.submit`
   * (+ `<name>.options` when any step declares `options`); the stepwise fallback registers
   * `<name>.step.fill`, `<name>.next`, `<name>.previous`, `<name>.submit`.
   */
  name: string
  /** LLM-facing description of the wizard. */
  description: string
  /** User-facing title (used in the submit confirmation summary). */
  title?: string
  /**
   * The steps, in order. Read through a ref except for `name`/`input`/`jsonSchema` identity: the
   * wizard re-registers when the step names, their count or an `input`/`jsonSchema` identity
   * changes. A step's `options` providers are read through refs (a fresh closure each render never
   * forces a re-registration); its `sensitive` list passes straight through to core.
   */
  steps: WizardStep[]
  /**
   * The parent's source of truth (e.g. a `useState` slice), one values object per step name.
   * Present together with {@link setData} selects parent-state mode (`createWizardTools`);
   * otherwise the hook uses the stepwise fallback (`createStepwiseWizardTools`), which then
   * requires {@link next}, {@link previous} and {@link currentAdapter}.
   */
  data?: Record<string, Record<string, unknown>>
  /** Replaces the parent data. Parent-state mode only; called at most once per `fill`/undo. */
  setData?: (next: Record<string, Record<string, unknown>>) => void
  /** Name of the current step. */
  current: string
  /**
   * Navigates to a step. Before calling this, `<name>.goTo` (parent-state mode) first writes the
   * mounted current step's values (via {@link currentAdapter}) into {@link data} — through
   * {@link setData} — so a `tm.undo()` or `<name>.submit` issued after navigating away still sees
   * them (spec §8.2; the wizard engine itself only writes the current step through its mounted
   * form, not into the parent data — see the Task 4 review). Read through a ref: a fresh closure
   * each render never forces a re-registration.
   */
  goTo(step: string): void
  /**
   * The mounted form of the current step, if any. Parent-state mode: optional (its absence falls
   * back to {@link resetCurrent}). Stepwise mode: required. Read through a ref on every call, so a
   * fresh adapter object each render is picked up without a re-registration.
   */
  currentAdapter?: FormAdapter
  /**
   * Parent-state mode without a mounted `currentAdapter`: called with the current step's merged
   * values after a `fill`/undo wrote them into {@link data}, so the app can reset its visible step
   * form. Its presence (not just its identity) is read once per registration: switching between
   * "has a `resetCurrent`" and "has none" re-registers the wizard.
   */
  resetCurrent?: (values: Record<string, unknown>) => void
  /** Validates the current step and moves forward. Stepwise mode only; required there. */
  next?(): Promise<ToolResult<unknown>>
  /** Moves back one step. Stepwise mode only; required there. */
  previous?(): void
  /**
   * Submits the wizard (consequential). In parent-state mode this is wrapped exactly like
   * {@link goTo}: the mounted current step's values are written into {@link data} first, so the
   * app's own `submit` (which typically reads {@link data}) sees them even when the agent never
   * navigated away from the current step before submitting.
   */
  submit(): Promise<ToolResult<unknown>>
  /**
   * User-facing submit confirmation summary. In stepwise mode (no {@link data}) this is called
   * with `{}` — the hook has no parent data to hand it in that mode.
   */
  submitSummary?: (data: Record<string, Record<string, unknown>>) => string
}

interface StepSignature {
  name: string
  input: unknown
  jsonSchema: unknown
}

function stepSignature(steps: WizardStep[]): StepSignature[] {
  return steps.map((s) => ({ name: s.name, input: s.input, jsonSchema: s.jsonSchema }))
}

function sameSignature(a: StepSignature[], b: StepSignature[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (s, i) =>
        s.name === b[i]!.name && s.input === b[i]!.input && s.jsonSchema === b[i]!.jsonSchema,
    )
  )
}

/**
 * @internal A revision number that increments whenever `steps`' names, count or `input`/
 * `jsonSchema` identities change, computed fresh every render and compared against the previous
 * render through a ref. Lets a variable-length `steps` array drive a `useEffect` dependency array
 * (which must have a fixed shape) without needing per-index entries.
 */
function useStepsRevision(steps: WizardStep[]): number {
  const signature = stepSignature(steps)
  const prevRef = useRef<StepSignature[] | null>(null)
  const revRef = useRef(0)
  if (prevRef.current === null || !sameSignature(prevRef.current, signature)) {
    prevRef.current = signature
    revRef.current += 1
  }
  return revRef.current
}

/**
 * @internal Wraps a step's `options` providers so each call looks up the *current* provider (by
 * step name and field key) through `optsRef` instead of closing over the one captured when the
 * wrapper was built — so a fresh provider closure passed on a later render is used without forcing
 * `stableSteps` (and therefore the whole wizard) to rebuild.
 */
function wrapStepOptions(
  stepName: string,
  keys: string[],
  optsRef: MutableRefObject<UseWizardToolOptions>,
): Record<string, OptionsProvider> {
  const wrapped: Record<string, OptionsProvider> = {}
  for (const key of keys) {
    wrapped[key] = (args) => {
      const step = optsRef.current.steps.find((s) => s.name === stepName)
      const provider = step?.options?.[key]
      return provider ? provider(args) : Promise.resolve([])
    }
  }
  return wrapped
}

/** @internal Builds one step's stable copy (options wrapped through `optsRef`; see above). */
function buildStableStep(
  stepName: string,
  optsRef: MutableRefObject<UseWizardToolOptions>,
): WizardStep {
  const step = optsRef.current.steps.find((s) => s.name === stepName)!
  return {
    name: step.name,
    ...(step.title !== undefined ? { title: step.title } : {}),
    input: step.input,
    ...(step.jsonSchema !== undefined ? { jsonSchema: step.jsonSchema } : {}),
    ...(step.files !== undefined ? { files: step.files } : {}),
    ...(step.options !== undefined
      ? { options: wrapStepOptions(step.name, Object.keys(step.options), optsRef) }
      : {}),
    ...(step.sensitive !== undefined ? { sensitive: step.sensitive } : {}),
  }
}

/**
 * Registers a multi-step wizard (spec §8.2, D25) while the component is mounted: parent-state mode
 * (`opts.data` + `opts.setData` present) uses `createWizardTools`; otherwise the stepwise fallback
 * (`createStepwiseWizardTools`) is used, which requires `opts.next`, `opts.previous` and
 * `opts.currentAdapter` — their absence is a misconfiguration (`ToolmarkError` code
 * `wizard_misconfigured` in development, an `error` event of the same code in production; nothing
 * is registered either way).
 *
 * Registration happens in an effect, under the current scope. `submit`, `goTo`, `next`,
 * `previous`, `setData`, `resetCurrent`, `currentAdapter` and every step's `options` providers are
 * read through refs, so a fresh closure/object each render never forces a re-registration by
 * itself and every call always uses the latest one. The wizard re-registers only when `name`,
 * `description`, `title`, the step names/count, a step's `input`/`jsonSchema` identity, or the
 * presence of `resetCurrent`/parent-state-vs-stepwise mode changes.
 *
 * **Current-step sync (Task 4 review, requirement (b)):** the wizard engine writes the *current*
 * step only through its mounted `currentAdapter`, never into `data` — so `data` alone can miss the
 * current step's latest edits. This hook closes that gap: right before `<name>.goTo` navigates
 * away and right before `<name>.submit` runs the app's `submit`, it writes the current step's
 * `currentAdapter.getValues()` into `data` (via `setData`), so a later `tm.undo()` or the app's own
 * `submit` (which typically reads `data`) both see them.
 *
 * **Synchronous parent-data reads (requirement (a)):** `setData` updates an internal ref
 * synchronously (in addition to calling the app's `setData`, which typically triggers a React
 * state update that only becomes visible on the next render). The wizard reads `data` through that
 * ref, so two `fill`/undo calls issued back-to-back — before React has re-rendered in between —
 * each see the other's write instead of one silently overwriting the other from a stale snapshot.
 *
 * Stepwise mode calls `refresh()` (bumping the current step's `<name>.step.fill` schema) whenever
 * `opts.current` changes, in a second effect that never itself re-registers the wizard.
 * @param opts - See {@link UseWizardToolOptions}.
 */
export function useWizardTool(opts: UseWizardToolOptions): void {
  const toolmark = useToolmark()
  const scope = useCurrentScope()
  const optsRef = useRef(opts)
  optsRef.current = opts
  const dataRef = useRef(opts.data)
  dataRef.current = opts.data
  const currentRef = useRef(opts.current)
  currentRef.current = opts.current
  const refreshRef = useRef<(() => void) | undefined>(undefined)

  const stepsRev = useStepsRevision(opts.steps)
  // `stepsRev` (names/schema identities) is this memo's real dependency; `optsRef` is a stable ref
  // object whose `.current` is read fresh inside the callback.
  const stableSteps = useMemo<WizardStep[]>(
    () => optsRef.current.steps.map((s) => buildStableStep(s.name, optsRef)),
    [stepsRev],
  )
  const stableStepsRef = useRef(stableSteps)
  stableStepsRef.current = stableSteps

  // `setData` also updates `dataRef` synchronously (requirement (a) above).
  const stableSetData = useMemo(
    () =>
      (next: Record<string, Record<string, unknown>>): void => {
        dataRef.current = next
        optsRef.current.setData?.(next)
      },
    [],
  )

  const syncCurrentIntoData = useMemo(
    () => (): void => {
      const adapter = optsRef.current.currentAdapter
      if (!adapter) return
      const merged = { ...(dataRef.current ?? {}), [currentRef.current]: adapter.getValues() }
      stableSetData(merged)
    },
    [stableSetData],
  )

  const currentAdapterGetter = useMemo(
    () => (): FormAdapter | undefined => optsRef.current.currentAdapter,
    [],
  )

  const stableGoTo = useMemo(
    () =>
      (step: string): void => {
        syncCurrentIntoData()
        optsRef.current.goTo(step)
      },
    [syncCurrentIntoData],
  )

  const stableWizardSubmit = useMemo(
    () => (): Promise<ToolResult<unknown>> => {
      syncCurrentIntoData()
      return optsRef.current.submit()
    },
    [syncCurrentIntoData],
  )

  const stableStepwiseSubmit = useMemo(
    () => (): Promise<ToolResult<unknown>> => optsRef.current.submit(),
    [],
  )

  const stableResetCurrent = useMemo(
    () =>
      (values: Record<string, unknown>): void => {
        optsRef.current.resetCurrent?.(values)
      },
    [],
  )

  const stableNext = useMemo(() => (): Promise<ToolResult<unknown>> => optsRef.current.next!(), [])
  const stablePrevious = useMemo(() => (): void => optsRef.current.previous?.(), [])

  const stableSubmitSummaryParent = useMemo(
    () =>
      (data: Record<string, Record<string, unknown>>): string =>
        optsRef.current.submitSummary?.(data) ?? '',
    [],
  )
  const stableSubmitSummaryStepwise = useMemo(
    () => (): string => optsRef.current.submitSummary?.({}) ?? '',
    [],
  )

  const stableCurrentStep = useMemo<StepwiseWizardOptions['currentStep']>(
    () => () => {
      const steps = stableStepsRef.current
      const step = steps.find((s) => s.name === currentRef.current) ?? steps[0]
      if (!step) {
        throw new ToolmarkError(
          'wizard_misconfigured',
          `Wizard "${optsRef.current.name}": no steps`,
        )
      }
      return {
        name: step.name,
        input: step.input,
        ...(step.jsonSchema !== undefined ? { jsonSchema: step.jsonSchema } : {}),
      }
    },
    [],
  )

  const parentMode = opts.data !== undefined && opts.setData !== undefined

  useEffect(() => {
    if (scope?.disposed) return undefined
    const current = optsRef.current

    if (!parentMode) {
      if (!current.next || !current.previous || !current.currentAdapter) {
        const message =
          `Wizard "${current.name}": the stepwise fallback (no data/setData) requires next, ` +
          `previous and currentAdapter`
        if (isDevEnvironment()) throw new ToolmarkError('wizard_misconfigured', message)
        emitEvent(toolmark, 'error', {
          code: 'wizard_misconfigured',
          message,
          tool: `${current.name}.step.fill`,
        })
        return undefined
      }
      const handle = createStepwiseWizardTools(toolmark, {
        name: current.name,
        description: current.description,
        ...(current.title !== undefined ? { title: current.title } : {}),
        currentAdapter: currentAdapterGetter,
        currentStep: stableCurrentStep,
        next: stableNext,
        previous: stablePrevious,
        submit: stableStepwiseSubmit,
        ...(current.submitSummary !== undefined
          ? { submitSummary: stableSubmitSummaryStepwise }
          : {}),
        ...(scope ? { scope } : {}),
      })
      refreshRef.current = () => handle.refresh()
      return () => {
        refreshRef.current = undefined
        handle.dispose()
      }
    }

    const handle = createWizardTools(toolmark, {
      name: current.name,
      description: current.description,
      ...(current.title !== undefined ? { title: current.title } : {}),
      steps: stableSteps,
      getData: () => dataRef.current ?? {},
      setData: stableSetData,
      getCurrent: () => currentRef.current,
      goTo: stableGoTo,
      currentAdapter: currentAdapterGetter,
      ...(current.resetCurrent !== undefined ? { resetCurrent: stableResetCurrent } : {}),
      submit: stableWizardSubmit,
      ...(current.submitSummary !== undefined ? { submitSummary: stableSubmitSummaryParent } : {}),
      ...(scope ? { scope } : {}),
    })
    refreshRef.current = undefined
    return () => handle.dispose()
  }, [
    toolmark,
    scope,
    parentMode,
    opts.name,
    opts.description,
    opts.title,
    opts.resetCurrent !== undefined,
    opts.submitSummary !== undefined,
    stableSteps,
    currentAdapterGetter,
    stableCurrentStep,
    stableNext,
    stablePrevious,
    stableStepwiseSubmit,
    stableSubmitSummaryStepwise,
    stableSetData,
    stableGoTo,
    stableResetCurrent,
    stableWizardSubmit,
    stableSubmitSummaryParent,
  ])

  // Stepwise fallback only: re-registers the current step's fill schema when `current` changes,
  // without re-running (or being triggered by) the registration effect above.
  useEffect(() => {
    refreshRef.current?.()
  }, [opts.current])
}
