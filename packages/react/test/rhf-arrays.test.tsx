import type { JSX } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { userEvent } from 'vitest/browser'
import { afterEach, describe, expect, it } from 'vitest'
import { useFieldArray, useForm, type Path } from 'react-hook-form'
import { z } from 'zod'
import { createToolmark } from '@toolmark/core'
import { ToolmarkProvider, useFormTool } from '../src/index.js'
import { rhfAdapter } from '../src/rhf/index.js'

afterEach(cleanup)

interface Values {
  sponsors: { name: string }[]
}

const schema = z.object({ sponsors: z.array(z.object({ name: z.string() })) })

function Harness(): JSX.Element {
  const form = useForm<Values>({ defaultValues: { sponsors: [{ name: 'A' }, { name: 'B' }] } })
  const { fields } = useFieldArray({ control: form.control, name: 'sponsors' })
  const adapter = rhfAdapter(form, { onSubmit: () => ({}) })
  useFormTool(adapter, { name: 'x', description: 'A form', input: schema })

  return (
    <ul>
      {fields.map((field, i) => (
        <li key={field.id} data-testid={`row-${i}`}>
          <input
            data-testid={`name-${i}`}
            {...form.register(`sponsors.${i}.name` as Path<Values>)}
          />
        </li>
      ))}
    </ul>
  )
}

describe('rhfAdapter field arrays', () => {
  it('rhf_field_array_replace_updates_rows', async () => {
    const tm = createToolmark({ dev: true })

    render(
      <ToolmarkProvider toolmark={tm}>
        <Harness />
      </ToolmarkProvider>,
    )

    expect(screen.getAllByTestId(/^row-/)).toHaveLength(2)

    const result = await act(() =>
      tm.call(
        'x.fill',
        { values: { sponsors: [{ name: 'X' }, { name: 'Y' }, { name: 'Z' }] } },
        { caller: 'test' },
      ),
    )
    expect(result.status).toBe('ok')

    expect(screen.getAllByTestId(/^row-/)).toHaveLength(3)
    expect(screen.getByTestId<HTMLInputElement>('name-0').value).toBe('X')
    expect(screen.getByTestId<HTMLInputElement>('name-1').value).toBe('Y')
    expect(screen.getByTestId<HTMLInputElement>('name-2').value).toBe('Z')
  })

  it('rhf_field_array_user_edit_skips_array', async () => {
    const tm = createToolmark({ dev: true })

    render(
      <ToolmarkProvider toolmark={tm}>
        <Harness />
      </ToolmarkProvider>,
    )

    await userEvent.clear(screen.getByTestId('name-0'))
    await userEvent.type(screen.getByTestId('name-0'), 'UserEdited')

    const result = await act(() =>
      tm.call(
        'x.fill',
        { values: { sponsors: [{ name: 'AgentA' }, { name: 'AgentB' }] } },
        { caller: 'test' },
      ),
    )
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect((result.data as { skipped: string[] }).skipped).toContain('sponsors')
    }
    // The array replace was skipped: the user's edit survives.
    expect(screen.getByTestId<HTMLInputElement>('name-0').value).toBe('UserEdited')
  })
})
