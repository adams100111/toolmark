import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import {
  createStepwiseWizardTools,
  createWizardTools,
  emitEvent,
  isDevRegistry,
  ToolmarkError,
  type FormAdapter,
  type OptionsProvider,
  type StepwiseWizardOptions,
  type ToolResult,
  type WizardStep,
} from '@toolmark/core'
import { useCurrentScope } from './scope.js'
import { useToolmark } from './provider.js'

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
   * Submits the wizard (consequential). In parent-state mode this is wrapped like {@link goTo}: the
   * mounted current step's values are first merged into {@link UseWizardToolOptions.data} (via {@link setData}), and
   * the merged parent data is passed as the argument.
   *
   * **Use the argument, not closed-over state.** `setData` typically schedules a React state update
   * that only becomes visible on the next render, while `submit` runs in the same tick — so a
   * `data` captured by this closure is the pre-merge snapshot and misses the current step's latest
   * edits. A zero-argument `submit` still works (the argument is simply ignored). In stepwise mode
   * (no {@link UseWizardToolOptions.data}) the argument is `{}`.
   */
  submit(data: Record<string, Record<string, unknown>>): Promise<ToolResult<unknown>>
  /**
   * User-facing submit confirmation summary. In parent-state mode it is called with a copy of
   * {@link UseWizardToolOptions.data} in which the current step is replaced by its live values (the mounted
   * {@link currentAdapter}'s values when present), so the confirmation reflects edits on the visible
   * step that have not been synced into `data` yet. In stepwise mode (no {@link UseWizardToolOptions.data}) this is
   * called with `{}` — the hook has no parent data to hand it in that mode.
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
 * `wizard_misconfigured` when the registry was created with `dev: true`, an `error` event of the
 * same code otherwise; nothing is registered either way).
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
 * `currentAdapter.getValues()` into `data` (via `setData`), so a later `tm.undo()` sees them. The
 * app's `submit` receives that merged data as its argument — read it from there, not from
 * closed-over state, which is still the pre-merge snapshot in that same tick.
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

  // Returns the (possibly merged) parent data, so `submit` can hand it to the app directly.
  const syncCurrentIntoData = useMemo(
    () => (): Record<string, Record<string, unknown>> => {
      const adapter = optsRef.current.currentAdapter
      if (!adapter) return dataRef.current ?? {}
      const merged = { ...(dataRef.current ?? {}), [currentRef.current]: adapter.getValues() }
      stableSetData(merged)
      return merged
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
    () => (): Promise<ToolResult<unknown>> => optsRef.current.submit(syncCurrentIntoData()),
    [syncCurrentIntoData],
  )

  const stableStepwiseSubmit = useMemo(
    () => (): Promise<ToolResult<unknown>> => optsRef.current.submit({}),
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
        if (isDevRegistry(toolmark)) throw new ToolmarkError('wizard_misconfigured', message)
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
