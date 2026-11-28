import { isObject } from '../state/json.js'
import type { RunProcess } from '../state/process.js'
import { ghJson, ghJsonLines, PrToolError } from './gh-client.js'
import { PROVENANCE_MARKER } from './provenance.js'

export interface CommentRef {
  id: number
  url: string
}

function parseCommentRef(raw: unknown, label: string): CommentRef {
  if (!isObject(raw) || typeof raw.id !== 'number' || typeof raw.url !== 'string') {
    throw new PrToolError(
      'gh-invalid-response',
      `gh ${label} returned an unexpected comment payload`,
    )
  }
  return { id: raw.id, url: raw.url }
}

export async function upsertProvenanceComment(
  run: RunProcess,
  repository: string,
  pr: number,
  comment: string,
  createOnly: boolean,
): Promise<CommentRef> {
  if (!createOnly) {
    const comments = await ghJsonLines(
      run,
      [
        'api',
        '--paginate',
        `repos/${repository}/issues/${pr}/comments`,
        '--jq',
        '.[] | {id, body: (.body // "")}',
      ],
      `api repos/${repository}/issues/${pr}/comments`,
    )
    const existing = comments.find(
      (entry) =>
        typeof entry.id === 'number' &&
        typeof entry.body === 'string' &&
        entry.body.trimStart().startsWith(PROVENANCE_MARKER),
    )
    if (existing !== undefined) {
      const id = existing.id as number
      const label = `api repos/${repository}/issues/comments/${id}`
      const raw = await ghJson(
        run,
        [
          'api',
          '-X',
          'PATCH',
          `repos/${repository}/issues/comments/${id}`,
          '-f',
          `body=${comment}`,
          '--jq',
          '{id, url: .html_url}',
        ],
        label,
      )
      return parseCommentRef(raw, label)
    }
  }
  const label = `api repos/${repository}/issues/${pr}/comments`
  const raw = await ghJson(
    run,
    [
      'api',
      '-X',
      'POST',
      `repos/${repository}/issues/${pr}/comments`,
      '-f',
      `body=${comment}`,
      '--jq',
      '{id, url: .html_url}',
    ],
    label,
  )
  return parseCommentRef(raw, label)
}
