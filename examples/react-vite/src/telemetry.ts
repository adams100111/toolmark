import { trace } from '@opentelemetry/api'
import {
  BasicTracerProvider,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'

/**
 * Dev-only tracing for the example: a `BasicTracerProvider` that prints every span to the console
 * and is registered as the global provider, so `tm.use(otel())` (which defaults to
 * `trace.getTracer('@toolmark/core')`) records on it. A real app would export spans with OTLP.
 * Payload attributes stay off (`otel()` records no inputs or results unless `recordPayloads`).
 */
export function installDevTelemetry(): void {
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(new ConsoleSpanExporter())],
  })
  trace.setGlobalTracerProvider(provider)
}
