import type { JSX } from 'react'
import { ChallengeForm } from './challenge-form'

/**
 * A server-rendered page (no `'use client'`) whose interactive form is the client component
 * {@link ChallengeForm} (spec D24: SSR renders it without a live registry).
 */
export default function Page(): JSX.Element {
  return (
    <main>
      <h1>Challenges</h1>
      <ChallengeForm />
    </main>
  )
}
