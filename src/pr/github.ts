import { isObject } from '../state/json.js'
import type { RunProcess } from '../state/process.js'
import { ghJson, ghJsonLines, PrToolError } from './gh-client.js'
import { PROVENANCE_MARKER } from './provenance.js'

export interface PullRef {
  number: number
  url: string
  nodeId: string
}

export interface PullDetails extends PullRef {
  title: string
  body: string
}

export interface CommentRef {
  id: number
  url: string
}

function parsePullRef(raw: unknown, label: string): PullRef {
  if (
    !isObject(raw) ||
    typeof raw.number !== 'number' ||
    typeof raw.url !== 'string' ||
    typeof raw.nodeId !== 'string'
  ) {
    throw new PrToolError(`gh ${label} returned an unexpected pull request payload`)
  }
  return { number: raw.number, url: raw.url, nodeId: raw.nodeId }
}

function parseCommentRef(raw: unknown, label: string): CommentRef {
  if (!isObject(raw) || typeof raw.id !== 'number' || typeof raw.url !== 'string') {
    throw new PrToolError(`gh ${label} returned an unexpected comment payload`)
  }
  return { id: raw.id, url: raw.url }
}

export async function readDefaultBranch(run: RunProcess, repository: string): Promise<string> {
  const raw = await ghJson(
    run,
    ['api', `repos/${repository}`, '--jq', '.default_branch'],
    `api repos/${repository}`,
  )
  if (typeof raw !== 'string' || raw === '') {
    throw new PrToolError(`GitHub returned no default branch for ${repository}`)
  }
  return raw
}

export async function readPull(
  run: RunProcess,
  repository: string,
  pr: number,
): Promise<PullDetails> {
  const label = `api repos/${repository}/pulls/${pr}`
  const raw = await ghJson(
    run,
    [
      'api',
      `repos/${repository}/pulls/${pr}`,
      '--jq',
      '{number, url: .html_url, nodeId: .node_id, title, body: (.body // "")}',
    ],
    label,
  )
  const ref = parsePullRef(raw, label)
  const obj = raw as Record<string, unknown>
  if (typeof obj.title !== 'string' || typeof obj.body !== 'string') {
    throw new PrToolError(`gh ${label} returned an unexpected pull request payload`)
  }
  return { ...ref, title: obj.title, body: obj.body }
}

export async function createPull(
  run: RunProcess,
  repository: string,
  params: { title: string; body: string; head: string; base: string; draft: boolean },
): Promise<PullRef> {
  const label = `api repos/${repository}/pulls`
  const raw = await ghJson(
    run,
    [
      'api',
      '-X',
      'POST',
      `repos/${repository}/pulls`,
      '-f',
      `title=${params.title}`,
      '-f',
      `body=${params.body}`,
      '-f',
      `head=${params.head}`,
      '-f',
      `base=${params.base}`,
      '-F',
      `draft=${String(params.draft)}`,
      '--jq',
      '{number, url: .html_url, nodeId: .node_id}',
    ],
    label,
  )
  return parsePullRef(raw, label)
}

export async function updatePull(
  run: RunProcess,
  repository: string,
  pr: number,
  params: { title: string; body: string },
): Promise<PullRef> {
  const label = `api repos/${repository}/pulls/${pr}`
  const raw = await ghJson(
    run,
    [
      'api',
      '-X',
      'PATCH',
      `repos/${repository}/pulls/${pr}`,
      '-f',
      `title=${params.title}`,
      '-f',
      `body=${params.body}`,
      '--jq',
      '{number, url: .html_url, nodeId: .node_id}',
    ],
    label,
  )
  return parsePullRef(raw, label)
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
