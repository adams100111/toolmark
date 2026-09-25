/** One captured `fetch` call, with the JSON request body already parsed. */
export interface CapturedCall {
  url: string
  body: { state: unknown; questions: Record<string, unknown>; model: string }
}

/**
 * A fake `fetch` for `/v1/systemone`: returns a real `Response` (so the SDK's own body/timeout
 * handling runs unmodified) built from `responses[call index]`, clamped to the last entry once
 * exhausted. Every call (including its parsed JSON body) is recorded in `calls`.
 */
export function fakeSystemOneFetch(responses: readonly Record<string, unknown>[]): {
  fetch: (input: string, init?: RequestInit) => Promise<Response>
  calls: CapturedCall[]
} {
  const calls: CapturedCall[] = []
  const fetchImpl = (url: string, init?: RequestInit): Promise<Response> => {
    const raw = typeof init?.body === 'string' ? init.body : '{}'
    calls.push({ url, body: JSON.parse(raw) as CapturedCall['body'] })
    const response = responses[Math.min(calls.length - 1, responses.length - 1)] ?? {}
    return Promise.resolve(
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
  }
  return { fetch: fetchImpl, calls }
}

/** A fake `fetch` that always answers with a given non-2xx HTTP status (an SDK `APIError`). */
export function fakeErrorFetch(
  status: number,
  body: unknown = {},
): (input: string, init?: RequestInit) => Promise<Response> {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    )
}
