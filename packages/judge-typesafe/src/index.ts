/**
 * `@toolmark/judge-typesafe` — The optional TypeSafe judge for `toolmark lint` (Node only, dev/CI only).
 * @packageDocumentation
 * @module @toolmark/judge-typesafe
 */
import {
  APIConnectionError,
  APIError,
  noul,
  score,
  TypeSafeClient,
  type EntryType,
  type NoulResponse,
  type Questions,
  type ScoreResponse,
} from '@typesafe-ai/sdk'
import type { ToolManifest } from '@toolmark/core'
import type { Finding, Judge } from '@toolmark/lint'
import { overlapPairs } from './overlap-pairs.js'
import { collectParams, type StateParam } from './schema-params.js'

/** Options for {@link typesafeJudge}. */
export interface TypesafeJudgeOptions {
  /** TypeSafe API key. Falls back to `process.env.TYPESAFE_API_KEY`. */
  apiKey?: string
  /** Expected-score floor (0-indexed rubric) below which a description gets `judge/description-quality`. Default `1.5`. */
  qualityThreshold?: number
  /** `noul` probability floor above which a non-hinted tool gets `judge/consequential-hint`. Default `0.85`. */
  hintThreshold?: number
  /** `noul` probability floor above which a tool pair gets `judge/overlap`. Default `0.8`. */
  overlapThreshold?: number
  /** Maximum overlap pairs checked per page; the rest are reported as `judge/overlap-truncated`. Default `200`. */
  maxPairs?: number
  /** When `true`, `judge/consequential-hint` findings are `error` instead of `warn`. Default `false`. */
  strictHints?: boolean
  /** Model override forwarded to `systemOne`. Default: the SDK's own default model. */
  model?: string
  /** Custom `fetch`, forwarded to `TypeSafeClient` (tests; alternate transports). */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>
}

const DEFAULT_QUALITY_THRESHOLD = 1.5
const DEFAULT_HINT_THRESHOLD = 0.85
const DEFAULT_OVERLAP_THRESHOLD = 0.8
const DEFAULT_MAX_PAIRS = 200
/** `TypeSafeClient`'s per-attempt timeout used by this judge (SDK default is 10000 ms). */
const REQUEST_TIMEOUT_MS = 60_000
/** `systemOne` accepts at most this many questions per request (Task 4 brief). */
const QUESTIONS_PER_REQUEST = 100

const QUALITY_QUESTION = 'How clearly does this description tell an agent when to use this tool?'
const QUALITY_RUBRIC = [
  'No usable guidance',
  'Vague',
  'Adequate',
  'Clear',
  'Precise, with when-to-use and when-not-to-use',
] as const
const HINT_QUESTION =
  'Does calling this tool change data, spend money, send messages or otherwise have effects the user must approve?'
const OVERLAP_QUESTION =
  'Would an agent likely confuse these two tools and call one when it meant the other?'

interface StateTool {
  name: string
  title?: string
  description: string
  params: StateParam[]
}

interface JudgeState {
  page: string
  tools: StateTool[]
}

function buildState(page: string, tools: readonly ToolManifest[]): JudgeState {
  return {
    page,
    tools: tools.map((tool) => ({
      name: tool.name,
      ...(tool.title !== undefined ? { title: tool.title } : {}),
      description: tool.description,
      params: collectParams(tool.inputSchema),
    })),
  }
}

function hasConsequentialHint(tool: ToolManifest): boolean {
  return Boolean(tool.hints.readOnly || tool.hints.consequential || tool.hints.destructive)
}

/** Splits `questions` into chunks of at most {@link QUESTIONS_PER_REQUEST} entries each. */
function chunkQuestions(questions: Questions): Questions[] {
  const entries = Object.entries(questions)
  if (entries.length === 0) return []
  const chunks: Questions[] = []
  for (let start = 0; start < entries.length; start += QUESTIONS_PER_REQUEST) {
    chunks.push(Object.fromEntries(entries.slice(start, start + QUESTIONS_PER_REQUEST)))
  }
  return chunks
}

let missingKeyWarned = false

/**
 * The optional TypeSafe (Jev) lint judge (Task 4 brief): probabilistic checks for description
 * quality, missing consequential/destructive hints and confusable tool pairs, run only when
 * `@toolmark/lint --judge` loads this module (dev/CI, never bundled into an app).
 *
 * Sends only tool names, titles, descriptions and schema property paths/descriptions to
 * `api.typesafe.ai` — never values, `default`, `enum`, `examples`, `const` or user data. Install
 * as a devDependency.
 *
 * @param o - See {@link TypesafeJudgeOptions}. All thresholds and `strictHints` have defaults.
 */
export function typesafeJudge(o: TypesafeJudgeOptions = {}): Judge {
  const qualityThreshold = o.qualityThreshold ?? DEFAULT_QUALITY_THRESHOLD
  const hintThreshold = o.hintThreshold ?? DEFAULT_HINT_THRESHOLD
  const overlapThreshold = o.overlapThreshold ?? DEFAULT_OVERLAP_THRESHOLD
  const maxPairs = o.maxPairs ?? DEFAULT_MAX_PAIRS
  const strictHints = o.strictHints ?? false

  return {
    name: 'typesafe',
    async judge({ page, tools }): Promise<Finding[]> {
      const apiKey = o.apiKey ?? process.env['TYPESAFE_API_KEY']
      if (apiKey === undefined || apiKey.trim().length === 0) {
        if (!missingKeyWarned) {
          missingKeyWarned = true
          process.stderr.write('toolmark lint: TYPESAFE_API_KEY not set; judge-typesafe disabled\n')
        }
        return []
      }

      const client = new TypeSafeClient({
        apiKey,
        timeout: REQUEST_TIMEOUT_MS,
        logLevel: 'warn',
        ...(o.fetch ? { fetch: o.fetch } : {}),
      })

      const state = buildState(page, tools)
      const questions: Record<string, Questions[string]> = {}
      for (let i = 0; i < tools.length; i++) {
        questions[`q:${i}`] = score(
          { question: QUALITY_QUESTION, tool: tools[i]!.name },
          QUALITY_RUBRIC,
        )
        if (!hasConsequentialHint(tools[i]!)) {
          questions[`h:${i}`] = noul({ question: HINT_QUESTION, tool: tools[i]!.name })
        }
      }

      const allPairs = overlapPairs(tools)
      const pairs = allPairs.slice(0, maxPairs)
      for (const { i, j } of pairs) {
        questions[`o:${i}:${j}`] = noul({
          question: OVERLAP_QUESTION,
          a: tools[i]!.name,
          b: tools[j]!.name,
        })
      }

      const answers: Record<string, NoulResponse | ScoreResponse> = {}
      try {
        for (const chunk of chunkQuestions(questions)) {
          const result = await client.systemOne({
            // `state` is a plain JSON-safe object (verified by construction); `EntryType`
            // requires an index signature, which a named interface never structurally satisfies.
            state: state as unknown as EntryType,
            questions: chunk,
            ...(o.model !== undefined ? { model: o.model } : {}),
          })
          Object.assign(answers, result.answers)
        }
      } catch (e) {
        if (e instanceof APIError || e instanceof APIConnectionError) {
          return [
            {
              rule: 'judge/unavailable',
              severity: 'warn',
              page,
              message: `TypeSafe judge unavailable: ${e.constructor.name}: ${e.message}`,
            },
          ]
        }
        throw e
      }

      const findings: Finding[] = []

      for (let i = 0; i < tools.length; i++) {
        const quality = answers[`q:${i}`] as ScoreResponse | undefined
        if (quality && quality.score < qualityThreshold) {
          findings.push({
            rule: 'judge/description-quality',
            severity: 'warn',
            tool: tools[i]!.name,
            page,
            message: `description quality score ${quality.score.toFixed(2)} is below the threshold ${qualityThreshold}`,
            score: quality.score,
          })
        }

        const hint = answers[`h:${i}`] as NoulResponse | undefined
        if (hint && hint.noul >= hintThreshold) {
          findings.push({
            rule: 'judge/consequential-hint',
            severity: strictHints ? 'error' : 'warn',
            tool: tools[i]!.name,
            page,
            message: `looks like it changes data or has effects the user should approve (${hint.noul.toFixed(2)}), but has no consequential/destructive/readOnly hint`,
            score: hint.noul,
          })
        }
      }

      for (const { i, j } of pairs) {
        const overlap = answers[`o:${i}:${j}`] as NoulResponse | undefined
        if (overlap && overlap.noul >= overlapThreshold) {
          findings.push({
            rule: 'judge/overlap',
            severity: 'warn',
            page,
            message: `"${tools[i]!.name}" and "${tools[j]!.name}" may be confused for one another (${overlap.noul.toFixed(2)})`,
            score: overlap.noul,
          })
        }
      }

      if (allPairs.length > pairs.length) {
        findings.push({
          rule: 'judge/overlap-truncated',
          severity: 'warn',
          page,
          message: `${allPairs.length - pairs.length} overlap pair(s) skipped past the ${maxPairs}-pair limit`,
        })
      }

      return findings
    },
  }
}

export default typesafeJudge
