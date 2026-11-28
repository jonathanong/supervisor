import { isObject } from '../state/json.js'
import type { RunProcess } from '../state/process.js'
import { ghJson, PrToolError, runGh } from './gh-client.js'

export interface PullRef {
  number: number
  url: string
  nodeId: string
}

export interface PullDetails extends PullRef {
  title: string
  body: string
}

function parsePullRef(raw: unknown, label: string): PullRef {
  if (
    !isObject(raw) ||
    typeof raw.number !== 'number' ||
    typeof raw.url !== 'string' ||
    typeof raw.nodeId !== 'string'
  ) {
    throw new PrToolError(
      'gh-invalid-response',
      `gh ${label} returned an unexpected pull request payload`,
    )
  }
  return { number: raw.number, url: raw.url, nodeId: raw.nodeId }
}

export async function readDefaultBranch(run: RunProcess, repository: string): Promise<string> {
  const stdout = await runGh(
    run,
    ['api', `repos/${repository}`, '--jq', '.default_branch'],
    `api repos/${repository}`,
  )
  const branch = stdout.trim()
  if (branch === '') {
    throw new PrToolError(
      'gh-invalid-response',
      `GitHub returned no default branch for ${repository}`,
    )
  }
  return branch
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
    throw new PrToolError(
      'gh-invalid-response',
      `gh ${label} returned an unexpected pull request payload`,
    )
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
  params: { title?: string; body?: string },
): Promise<PullRef> {
  const label = `api repos/${repository}/pulls/${pr}`
  const fields = [
    ...(params.title !== undefined ? ['-f', `title=${params.title}`] : []),
    ...(params.body !== undefined ? ['-f', `body=${params.body}`] : []),
  ]
  const raw = await ghJson(
    run,
    [
      'api',
      '-X',
      'PATCH',
      `repos/${repository}/pulls/${pr}`,
      ...fields,
      '--jq',
      '{number, url: .html_url, nodeId: .node_id}',
    ],
    label,
  )
  return parsePullRef(raw, label)
}
