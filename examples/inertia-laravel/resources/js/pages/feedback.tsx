import { Form, router } from '@inertiajs/react'
import { useEffect, useRef, type ComponentRef, type JSX } from 'react'
import { createFormTools, fromJsonSchema } from '@toolmark/core'
import { synthesizeFormSchema } from '@toolmark/core/dom'
import { inertiaFormComponentAdapter } from '@toolmark/inertia'
import { useToolmark } from '@toolmark/react'
import { Layout } from '@/layout'
import { store } from '@/routes/feedback'

/** An uncontrolled Inertia `<Form>`, exposed as `feedback.fill` / `feedback.submit`. */
export default function Feedback(props: { topics: string[] }): JSX.Element {
  const tm = useToolmark()
  const formRef = useRef<ComponentRef<typeof Form>>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = box.current?.querySelector('form')
    if (!element) return
    const adapter = inertiaFormComponentAdapter({ element, formRef, router })
    const schema = synthesizeFormSchema(element)
    const tools = createFormTools(tm, adapter, {
      name: 'feedback',
      title: 'Feedback',
      description: 'Feedback form for this app: a topic and a message of at least 10 characters.',
      input: fromJsonSchema(schema),
      jsonSchema: schema,
    })
    return () => {
      tools.dispose()
      adapter.dispose()
    }
  }, [tm])

  return (
    <Layout title="Feedback">
      <div ref={box}>
        <Form ref={formRef} action={store.url()} method="post" resetOnSuccess>
          {({ errors }: { errors: Record<string, string | undefined> }) => (
            <>
              <p>
                <label>
                  Topic{' '}
                  <select name="topic" required defaultValue={props.topics[0]}>
                    {props.topics.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
              </p>
              <p>
                <label>
                  Message <textarea name="message" required minLength={10} maxLength={2000} />
                </label>
                {errors.message && <span role="alert">{errors.message}</span>}
              </p>
              <button type="submit">Send feedback</button>
            </>
          )}
        </Form>
      </div>
    </Layout>
  )
}
