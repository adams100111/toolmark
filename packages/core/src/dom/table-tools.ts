import { fromJsonSchema } from '../json-schema/from-json-schema.js'
import { ok } from '../result.js'
import type { JsonSchema, ToolDefinition } from '../tool.js'
import { cap, getAttr } from './elements.js'

/** @internal Default rows returned by a table query. */
export const TABLE_DEFAULT_LIMIT = 50
/** @internal Most rows returned by a table query (larger `limit`s are clamped). */
export const TABLE_MAX_LIMIT = 500
/** @internal Longest cell text returned (longer text is truncated with `…`). */
export const MAX_CELL_TEXT = 1000
/** @internal Longest `where` filter string accepted. */
export const MAX_WHERE_LENGTH = 1000
/** @internal Most queryable columns per table (further `data-tool-column`s are skipped). */
export const TABLE_MAX_COLUMNS = 32
/**
 * @internal Character budget of a table result's `rows` (their JSON length); rows past it are left
 * out and the result says `truncated: true`.
 */
export const TABLE_RESULT_BUDGET = 200_000

const COLUMN_NAME = /^[A-Za-z0-9_-]{1,64}$/
const UNSAFE = new Set(['__proto__', 'prototype', 'constructor'])

/** @internal One queryable column (from a `th[data-tool-column]`). */
export interface TableColumn {
  /** Property name in each row (the attribute value). */
  name: string
  /** `data-tool-type="number"` → numbers (`null` when unparsable). */
  number: boolean
}

/** Header cells of `table` itself (not of nested tables) that declare a column. */
function columnHeaders(table: HTMLTableElement): HTMLTableCellElement[] {
  return [...table.querySelectorAll<HTMLTableCellElement>('th[data-tool-column]')].filter(
    (th) => th.closest('table') === table,
  )
}

/**
 * @internal The columns a `data-tool` table declares, in header order. Names must match
 * `^[A-Za-z0-9_-]{1,64}$` and not be `__proto__`/`prototype`/`constructor`; a repeated name keeps
 * its first header; at most {@link TABLE_MAX_COLUMNS} columns (the rest are reported once).
 * Rejected names are reported through `reject`.
 * @param table - The table.
 * @param reject - Called with each rejected column name and why.
 */
export function tableColumns(
  table: HTMLTableElement,
  reject: (name: string, reason: string) => void,
): TableColumn[] {
  const columns: TableColumn[] = []
  const headers = columnHeaders(table)
  for (const [i, th] of headers.entries()) {
    const name = (getAttr(th, 'data-tool-column') ?? '').trim()
    if (columns.length >= TABLE_MAX_COLUMNS) {
      const rest = headers.length - i
      reject(name, `more than ${TABLE_MAX_COLUMNS} columns; ${rest} column(s) from here skipped`)
      break
    }
    if (!COLUMN_NAME.test(name) || UNSAFE.has(name)) {
      reject(name, 'invalid column name')
      continue
    }
    if (columns.some((c) => c.name === name)) {
      reject(name, 'duplicate column name')
      continue
    }
    columns.push({
      name,
      number: (getAttr(th, 'data-tool-type') ?? '').trim().toLowerCase() === 'number',
    })
  }
  return columns
}

/** Visual column index of a cell (sum of the `colSpan`s before it in its row). */
function visualIndex(cell: HTMLTableCellElement): number {
  let index = 0
  const row = cell.parentElement as HTMLTableRowElement | null
  if (!row) return -1
  for (const c of row.cells) {
    if (c === cell) return index
    index += Math.max(1, c.colSpan)
  }
  return -1
}

/** The cell of `row` that covers visual column `index` (colspans honoured, rowspans not). */
function cellAt(row: HTMLTableRowElement, index: number): HTMLTableCellElement | undefined {
  let at = 0
  for (const c of row.cells) {
    const span = Math.max(1, c.colSpan)
    if (index < at + span) return c
    at += span
  }
  return undefined
}

function parseNumber(text: string): number | null {
  if (text === '') return null
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

interface TableQuery {
  where?: Record<string, string>
  limit?: number
}

/**
 * @internal The read-only query tool of a `data-tool` table (spec §10.2): input
 * `{ where?: { [column]: string }, limit?: integer ≥ 1 }`; `where` matches rows whose cell text
 * contains every given string (case-insensitive); `limit` defaults to 50 and is clamped to 500.
 * Returns `ok({ rows, total })`: `rows` are objects keyed by column name with the cell's trimmed
 * `textContent` (capped at 1000 characters; number columns parse, unparsable or empty → `null`),
 * `total` is the number of matching rows before the limit. The rows' JSON is kept within
 * {@link TABLE_RESULT_BUDGET} characters: rows past it are left out and `truncated: true` is set
 * (`total` still counts every match). Rows are the `<tbody>` rows of the
 * table read at call time; a row that holds a column header is skipped. Hints: `readOnly`,
 * `untrustedContent` (cells are page/user content). Its anchor (`tm.anchor(name)`) is the `<table>`.
 * @param table - The table.
 * @param name - Local tool name.
 * @param description - LLM-facing description (from app-authored markup).
 * @param columns - Columns from {@link tableColumns} (at least one).
 */
export function tableToolDefinition(
  table: HTMLTableElement,
  name: string,
  description: string,
  columns: TableColumn[],
): ToolDefinition<
  TableQuery,
  { rows: Record<string, string | number | null>[]; total: number; truncated?: true }
> {
  const whereProps: Record<string, JsonSchema> = {}
  for (const c of columns) whereProps[c.name] = { type: 'string', maxLength: MAX_WHERE_LENGTH }
  const input = fromJsonSchema<TableQuery>({
    type: 'object',
    properties: {
      where: {
        type: 'object',
        description: 'Case-insensitive substring filters by column; every filter must match.',
        properties: whereProps,
        additionalProperties: false,
      },
      limit: {
        type: 'integer',
        minimum: 1,
        description: `Maximum rows to return (default ${TABLE_DEFAULT_LIMIT}, at most ${TABLE_MAX_LIMIT}).`,
      },
    },
    additionalProperties: false,
  })
  const columnList = columns.map((c) => (c.number ? `${c.name} (number)` : c.name)).join(', ')
  return {
    name,
    description: `${description} Query the table's rows. Columns: ${columnList}.`,
    input,
    hints: { readOnly: true, untrustedContent: true },
    origin: 'dom',
    // Tour hooks (spec §13): the `<table>` itself.
    anchors: { element: () => table },
    run(query) {
      const limit = Math.min(query.limit ?? TABLE_DEFAULT_LIMIT, TABLE_MAX_LIMIT)
      const headers = columnHeaders(table)
      const indexes = new Map<string, number>()
      for (const th of headers) {
        const n = (getAttr(th, 'data-tool-column') ?? '').trim()
        if (!indexes.has(n)) indexes.set(n, visualIndex(th))
      }
      const filters = Object.entries(query.where ?? {}).map(
        ([column, value]) => [column, value.toLowerCase()] as const,
      )
      const text = (row: HTMLTableRowElement, column: string): string => {
        const index = indexes.get(column)
        const cell = index === undefined || index < 0 ? undefined : cellAt(row, index)
        return (cell?.textContent ?? '').trim()
      }
      const rows: Record<string, string | number | null>[] = []
      let total = 0
      let used = 2 // `[]`
      let truncated = false
      for (const body of table.tBodies) {
        for (const row of body.rows) {
          if (row.querySelector('th[data-tool-column]') !== null) continue
          if (!filters.every(([c, v]) => text(row, c).toLowerCase().includes(v))) continue
          total++
          if (rows.length >= limit || truncated) continue
          const out: Record<string, string | number | null> = {}
          for (const c of columns) {
            const raw = text(row, c.name)
            out[c.name] = c.number ? parseNumber(raw) : cap(raw, MAX_CELL_TEXT)
          }
          const size = JSON.stringify(out).length + 1
          if (used + size > TABLE_RESULT_BUDGET) {
            truncated = true
            continue
          }
          used += size
          rows.push(out)
        }
      }
      return ok(truncated ? { rows, total, truncated: true as const } : { rows, total })
    },
  }
}
