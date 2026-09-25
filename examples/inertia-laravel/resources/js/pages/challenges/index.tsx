import type { JSX } from 'react'
import { Layout } from '@/layout'

interface ChallengeRow {
  id: number
  titleEn: string
  titleAr: string
  type: string
  startsAt: string
  archived: boolean
}

/**
 * The challenge list. Its only tool is server-declared: `challenges.archive` arrives in the
 * `toolmark` prop (already filtered by the server's authorization) and `inertiaPages` registers it.
 */
export default function ChallengesIndex(props: { challenges: ChallengeRow[] }): JSX.Element {
  return (
    <Layout title="Challenges">
      {props.challenges.length === 0 ? (
        <p>No challenges yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">Id</th>
              <th scope="col">Title</th>
              <th scope="col">Type</th>
              <th scope="col">Starts</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {props.challenges.map((c) => (
              <tr key={c.id} data-testid={`challenge-${c.id}`}>
                <td>{c.id}</td>
                <td>
                  {c.titleEn} / <span lang="ar">{c.titleAr}</span>
                </td>
                <td>{c.type}</td>
                <td>{c.startsAt}</td>
                <td data-testid={`challenge-${c.id}-status`}>
                  {c.archived ? 'Archived' : 'Active'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Layout>
  )
}
