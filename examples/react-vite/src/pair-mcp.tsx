import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react'
import { useToolmark } from '@toolmark/react'
import { DEFAULT_PAIRING_PORT, mcpPairing, type McpPairingStatus } from '@toolmark/mcp/client'

/** The pairing port: the `?mcpPort=` query value, else `toolmark-mcp`'s default `17840`. */
function pairingPort(): number {
  const raw = new URLSearchParams(window.location.search).get('mcpPort')
  const port = raw === null ? NaN : Number(raw)
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_PAIRING_PORT
}

/**
 * The "Pair with desktop MCP" panel. On load it resumes a pairing from the session token (inert
 * without one); entering the code printed by `toolmark-mcp` (or returned by its `toolmark_pairing`
 * tool) pairs this page with that MCP server.
 */
export function PairMcpPanel(): JSX.Element {
  const tm = useToolmark()
  const [port] = useState(pairingPort)
  const [status, setStatus] = useState<McpPairingStatus | 'unpaired'>('unpaired')
  const [code, setCode] = useState('')
  const detach = useRef<(() => void) | null>(null)

  useEffect(() => {
    // Resume after a reload: mcpPairing without a code uses the stored session token.
    detach.current = tm.use(mcpPairing({ port, onStatus: setStatus }))
    return () => {
      detach.current?.()
      detach.current = null
    }
  }, [tm, port])

  const pair = (e: FormEvent): void => {
    e.preventDefault()
    const typed = code.trim()
    if (typed === '') return
    detach.current?.()
    detach.current = tm.use(mcpPairing({ code: typed, port, onStatus: setStatus }))
    setCode('')
  }

  return (
    <section
      aria-label="Pair with desktop MCP"
      style={{ borderTop: '1px solid', marginTop: '1rem' }}
    >
      <h2>Pair with desktop MCP</h2>
      <form onSubmit={pair}>
        <label>
          Pairing code
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="XXXX-XXXX"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <button type="submit">Pair</button>
      </form>
      <p>
        Port {port}: <output data-testid="mcp-status">{status}</output>
      </p>
    </section>
  )
}
