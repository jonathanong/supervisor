import { isObject } from '../state/json.js'
import type { RunProcess } from '../state/process.js'
import { ghJson, PrToolError, runGh } from './gh-client.js'

const ISSUE_TAXONOMY_QUERY = `
query($owner: String!, $repo: String!, $issue: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $issue) {
      milestone { number state title }
      projectItems(first: 20) {
        nodes {
          project { id title closed }
        }
      }
    }
  }
}`.trim()

const ADD_PROJECT_ITEM_MUTATION = `
mutation($projectId: ID!, $contentId: ID!) {
  addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
    item { id }
  }
}`.trim()

export interface IssueTaxonomy {
  milestone: { number: number; title: string } | null
  projects: Array<{ id: string; title: string }>
}

export async function readIssueTaxonomy(
  run: RunProcess,
  repository: string,
  issue: number,
): Promise<IssueTaxonomy> {
  const [owner, repo] = repository.split('/') as [string, string]
  const raw = await ghJson(
    run,
    [
      'api',
      'graphql',
      '-f',
      `query=${ISSUE_TAXONOMY_QUERY}`,
      '-f',
      `owner=${owner}`,
      '-f',
      `repo=${repo}`,
      '-F',
      `issue=${issue}`,
    ],
    'api graphql',
  )
  const data = isObject(raw) && isObject(raw.data) ? raw.data : undefined
  const repoObj = data && isObject(data.repository) ? data.repository : undefined
  const issueObj = repoObj && isObject(repoObj.issue) ? repoObj.issue : undefined
  if (!issueObj) {
    throw new PrToolError('not-found', `Issue ${repository}#${issue} was not found.`)
  }
  let milestone: { number: number; title: string } | null = null
  if (
    isObject(issueObj.milestone) &&
    issueObj.milestone.state === 'OPEN' &&
    typeof issueObj.milestone.number === 'number' &&
    typeof issueObj.milestone.title === 'string'
  ) {
    milestone = { number: issueObj.milestone.number, title: issueObj.milestone.title }
  }
  const projects: Array<{ id: string; title: string }> = []
  const seen = new Set<string>()
  const items = isObject(issueObj.projectItems) ? issueObj.projectItems : undefined
  const nodes = items && Array.isArray(items.nodes) ? items.nodes : []
  for (const node of nodes) {
    if (!isObject(node) || !isObject(node.project)) continue
    const proj = node.project
    if (
      proj.closed === false &&
      typeof proj.id === 'string' &&
      typeof proj.title === 'string' &&
      !seen.has(proj.id)
    ) {
      seen.add(proj.id)
      projects.push({ id: proj.id, title: proj.title })
    }
  }
  return { milestone, projects }
}

export async function applyIssueTaxonomy(
  run: RunProcess,
  repository: string,
  pr: number,
  prNodeId: string,
  taxonomy: IssueTaxonomy,
): Promise<void> {
  if (taxonomy.milestone !== null) {
    await runGh(
      run,
      [
        'api',
        '-X',
        'PATCH',
        `repos/${repository}/issues/${pr}`,
        '-F',
        `milestone=${taxonomy.milestone.number}`,
        '--jq',
        '{milestone: (.milestone.number // null)}',
      ],
      `api repos/${repository}/issues/${pr}`,
    )
  }
  for (const project of taxonomy.projects) {
    await runGh(
      run,
      [
        'api',
        'graphql',
        '-f',
        `query=${ADD_PROJECT_ITEM_MUTATION}`,
        '-f',
        `projectId=${project.id}`,
        '-f',
        `contentId=${prNodeId}`,
      ],
      'api graphql',
    )
  }
}
