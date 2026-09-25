import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'
import type { ToolResult } from '@toolmark/core'
import type { AgentToPageMessage, PageToAgentMessage } from '@toolmark/core/protocol'

type ManifestMessage = Extract<PageToAgentMessage, { type: 'manifest' }>
type ConfirmedMessage = Extract<PageToAgentMessage, { type: 'confirmed' }>

/** One row of the round-budget report (overview "Success criterion 1"). */
export interface RoundBudgetEntry {
  task: string
  rounds: number
  messages: number
  manifestBytes: number
  describeBytes: number
  wallMs: number
}

/** A message the scripted agent sends, without the `protocol`/`clientId` envelope fields. */
export type AgentMessageBody =
  | { type: 'call'; id: string; tool: string; input: unknown; rev?: number }
  | { type: 'describe'; id: string; tool: string }
  | { type: 'cancel'; id: string }

const utf8Bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8')

/**
 * Drives the page's scripted in-page agent (`window.__toolmark_agent__`) and measures a task.
 *
 * A **round** is one agent turn issuing ≥ 1 `describe`/`call` (all agent→page messages sent before
 * it next awaits results); each {@link RoundRecorder.turn} invocation is one round. Human
 * confirmation (clicking Approve on the confirm card) is not a round.
 */
export class RoundRecorder {
  rounds = 0
  messages = 0
  describeBytes = 0
  manifestBytes = 0
  /** Every result the agent received (turn replies and `confirmed` outcomes). */
  readonly results: ToolResult<unknown>[] = []
  private clientId = ''
  private startedAt: number | undefined
  private endedAt: number | undefined

  constructor(private readonly page: Page) {}

  /** Waits for the attach `manifest` and records its size; returns it (the agent's starting point). */
  async attach(): Promise<ManifestMessage> {
    await this.page.waitForFunction(() => globalThis.__toolmark_agent__?.manifest !== undefined)
    const manifest = await this.page.evaluate(() => globalThis.__toolmark_agent__!.manifest!)
    this.clientId = manifest.clientId
    this.manifestBytes = utf8Bytes(manifest)
    return manifest
  }

  /** Runs one agent turn (one round): sends every message, awaits one reply per call/describe. */
  async turn(bodies: AgentMessageBody[]): Promise<PageToAgentMessage[]> {
    if (bodies.length === 0) throw new Error('a round issues at least one message')
    const messages = bodies.map(
      (b) => ({ protocol: 1, clientId: this.clientId, ...b }) as AgentToPageMessage,
    )
    this.startedAt ??= Date.now()
    this.rounds += 1
    this.messages += messages.length
    const replies = await this.page.evaluate(
      (m) => globalThis.__toolmark_agent__!.turn(m),
      messages,
    )
    for (const reply of replies) {
      if (reply.type !== 'result') continue
      this.results.push(reply.result)
      const sent = messages.find((m) => m.type !== 'cancel' && m.id === reply.id)
      if (sent?.type === 'describe') this.describeBytes += utf8Bytes(reply.result)
    }
    return replies
  }

  /** Waits for the `confirmed` message of `confirmId` (the final result) and stops the clock. */
  async confirmed(confirmId: string): Promise<ConfirmedMessage> {
    const message = await this.page.evaluate(
      (id) => globalThis.__toolmark_agent__!.waitForConfirmed(id),
      confirmId,
    )
    this.results.push(message.result)
    this.endedAt = Date.now()
    return message
  }

  /** Results with status `invalid` or `refused`. */
  get failures(): ToolResult<unknown>[] {
    return this.results.filter((r) => r.status === 'invalid' || r.status === 'refused')
  }

  /** The report entry for `task`. */
  entry(task: string): RoundBudgetEntry {
    const start = this.startedAt ?? Date.now()
    return {
      task,
      rounds: this.rounds,
      messages: this.messages,
      manifestBytes: this.manifestBytes,
      describeBytes: this.describeBytes,
      wallMs: (this.endedAt ?? Date.now()) - start,
    }
  }

  /**
   * Appends the entry for `task` to the JSON array at `ROUND_BUDGET_REPORT` (resolved against the
   * working directory), when that variable is set. The round-budget spec runs serially, so appends
   * never race.
   */
  async report(task: string): Promise<RoundBudgetEntry> {
    const entry = this.entry(task)
    const target = process.env.ROUND_BUDGET_REPORT
    if (target) {
      const file = resolve(target)
      let existing: RoundBudgetEntry[] = []
      try {
        const parsed: unknown = JSON.parse(await readFile(file, 'utf8'))
        if (Array.isArray(parsed)) existing = parsed as RoundBudgetEntry[]
      } catch {
        existing = []
      }
      const rows = existing.filter((row) => row.task !== task)
      rows.push(entry)
      await writeFile(file, `${JSON.stringify(rows, null, 2)}\n`)
    }
    return entry
  }
}
