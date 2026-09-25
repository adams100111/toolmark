import type { ToolManifest, ToolManifestSummary } from '@toolmark/core'

/**
 * How a tour runs (spec §11.5):
 * - `show` — highlight and explain; the user acts and presses Next.
 * - `guide` — wait for the user's own interaction events on the step's field and validate them
 *   through `tm.state()`; needs a form adapter with `onUserInteraction`.
 * - `do` — run each step's tool as caller `tour` (policy and inline confirmation apply) and
 *   highlight every changed field.
 */
export type TourMode = 'show' | 'guide' | 'do'

/**
 * One tour step. Steps reference tools and params, never CSS selectors (spec §11.5).
 * @example `{ tool: 'challenges.create.fill', param: 'type', text: 'Pick the challenge type' }`
 */
export interface TourStep {
  /** Full tool name, e.g. `challenges.create.fill`. */
  tool: string
  /** Input path the step points at, e.g. `type`, `items.0.qty`, or `<step>.<path>` for wizards. */
  param?: string
  /** App-localized step title. */
  title?: string
  /** App-localized explanation shown for the step. */
  text: string
  /**
   * `do` mode: the tool input. Form fills may pass the field values directly (wrapped as
   * `{ values }` when the tool's input schema has a `values` property); wizard fills pass
   * `{ steps: … }` unchanged. Omitted → `{}`.
   */
  input?: unknown
  /** `guide` mode: advance on a valid `input` (default) or on the user's `submit`. */
  waitFor?: 'input' | 'submit'
}

/** What a {@link Planner} receives. */
export interface PlannerContext {
  /** What the user wants to achieve, as given to `startTour`. */
  goal: string
  /** The mode the planned tour will run in. */
  mode: TourMode
  /** Summary manifest of the tools visible to caller `tour`. */
  tools: ToolManifestSummary[]
  /** Full manifest entry of one tool as visible to caller `tour`, or `undefined`. */
  describe(name: string): ToolManifest | undefined
  /** Aborted when the tour start is cancelled. */
  signal: AbortSignal
}

/**
 * App-supplied tour planner (e.g. the server agent over the bridge). Planned steps are untrusted:
 * the engine keeps only steps whose tool is visible to caller `tour` and whose `param` exists in
 * that tool's input schema.
 */
export interface Planner {
  /**
   * Plans the steps for a goal. A rejection rejects `startTour` with the same error.
   * @param ctx - Goal, mode, the tools visible to caller `tour`, and the start signal.
   */
  plan(ctx: PlannerContext): Promise<TourStep[]>
}

/** Snapshot of a running tour. A new frozen object on every change. */
export interface TourState {
  /**
   * - `idle` — not started yet.
   * - `running` — on a step (in `do` mode: its call may be in flight).
   * - `waiting` — `guide` mode: the user's input has issues (see `message`).
   * - `confirming` — `do` mode: an inline confirmation of the step's call is pending (a
   *   consequential/destructive tool, or `ctx.confirm` inside its `run`); the app's confirmation
   *   UI must stay usable.
   * - `done` — every step completed.
   * - `stopped` — `stop()`, an aborted signal, a failed `do` call or no valid steps.
   */
  status: 'idle' | 'running' | 'waiting' | 'confirming' | 'done' | 'stopped'
  /** The tour's mode. */
  mode: TourMode
  /** Index of the current step in `steps`. */
  index: number
  /** The (validated) steps. */
  steps: readonly TourStep[]
  /** The current step's anchor element, or `null`. */
  anchor: Element | null
  /** `do` mode: the changed field being highlighted, else `null`. */
  highlight?: Element | null
  /**
   * `do` mode: the step's call is in flight (`next()`/`back()` are ignored). The overlay marks
   * Next/Back `aria-disabled` and announces it.
   */
  busy: boolean
  /** `waiting`: the first issue of the field; `stopped`: why the tour stopped. */
  message?: string
}

/** Tour lifecycle events. */
export type TourEvent =
  | {
      /**
       * - `step_invalid` — a planned step was dropped (`reason` `unknown_tool`, `unknown_param` or
       *   `malformed_step`).
       * - `anchor_missing` — the step's element is not rendered; the step was skipped.
       * - `step_skipped` — the step's tool disappeared mid-tour (`reason` `tool_removed`).
       */
      type: 'step_invalid' | 'anchor_missing' | 'step_skipped'
      step: TourStep
      reason: string
    }
  | { type: 'step_entered'; step: TourStep; index: number }
  | { type: 'done' }

/** A running tour (headless engine; render it with the overlay or `useTour`). */
export interface Tour {
  /** Current state snapshot. */
  readonly state: TourState
  /**
   * Moves to the next step (after the last: `done`). Ignored while a `do` call is in flight;
   * skips a running `do` highlight sequence. Resolves once the next step has been entered.
   */
  next(): Promise<void>
  /**
   * Moves to the previous step. Only the index moves: in `do` mode nothing is undone and no call
   * is repeated (apps use `tm.undo`); a step that has not run yet (it was skipped) runs on the
   * next `next()`, not on entry. Ignored while a `do` call is in flight.
   */
  back(): void
  /** Stops the tour (`stopped`) and releases every listener and timer. Idempotent. */
  stop(): void
  /**
   * Subscribes to state changes (not called with the current state).
   * @returns The unsubscribe function.
   */
  subscribe(fn: (s: TourState) => void): () => void
  /**
   * Subscribes to lifecycle events. Events emitted before the first listener subscribed (e.g.
   * `step_invalid` from validation and the first `step_entered`) are delivered to that first
   * listener when it subscribes.
   * @returns The unsubscribe function.
   */
  on(fn: (e: TourEvent) => void): () => void
}

/** Options for `startTour`. Pass exactly one of `steps` or `goal` + `planner`. */
export interface StartTourOptions {
  /** The tour mode. */
  mode: TourMode
  /** Authored steps. */
  steps?: TourStep[]
  /** Goal for the `planner`. */
  goal?: string
  /** App-supplied planner for `goal`. */
  planner?: Planner
  /**
   * Skip the `do`-mode highlight sequence. Default:
   * `matchMedia('(prefers-reduced-motion: reduce)').matches`.
   */
  reducedMotion?: boolean
  /** Aborting stops the tour (and is passed to the planner and to `do` calls). */
  signal?: AbortSignal
}
