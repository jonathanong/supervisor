import { PrToolError } from './gh-client.js'
import { upsertProvenanceComment } from './comments.js'
import type { PullRef } from './github.js'
import {
  renderProvenanceComment,
  sanitizeProvenanceInput,
  type ProvenanceInput,
} from './provenance.js'
import { stripCredentials } from './redact.js'
import { applyIssueTaxonomy, readIssueTaxonomy, type IssueTaxonomy } from './taxonomy.js'
import { extractClosingIssue, validatePr } from './validate.js'
import type { RunProcess } from '../state/process.js'

export interface PrWriteResult {
  repository: string
  pr: number
  url: string
  provenanceCommentId: number
  provenanceCommentUrl: string
  provenanceComment: string
  redacted: boolean
  inherited: {
    issue: number | null
    milestone: { number: number; title: string } | null
    projects: Array<{ id: string; title: string }>
  }
}

export interface PreparedPrWrite {
  title: string
  body: string
  provenanceComment: string
  redacted: boolean
  linkedIssue: number | undefined
  taxonomy: IssueTaxonomy
}

export async function preparePrWrite(
  params: {
    repository: string
    title: string
    body: string
    issue?: number
    provenance: ProvenanceInput
    extraFields: readonly string[]
  },
  runProcess: RunProcess,
): Promise<PreparedPrWrite> {
  const cleanTitle = stripCredentials(params.title)
  const cleanBody = stripCredentials(params.body)
  const cleanProv = sanitizeProvenanceInput(params.provenance)
  const redacted = cleanTitle.redacted || cleanBody.redacted || cleanProv.redacted
  const provenanceComment = renderProvenanceComment(cleanProv.input, params.extraFields)
  const validation = validatePr({
    title: cleanTitle.text,
    body: cleanBody.text,
    provenanceComment,
    extraFields: params.extraFields,
  })
  if (!validation.valid) {
    const details = validation.errors.map((e) => `- [${e.rule}] ${e.message}`).join('\n')
    throw new PrToolError('validation-failed', `PR validation failed:\n${details}`)
  }
  const linkedIssue = params.issue ?? extractClosingIssue(cleanBody.text, params.repository)
  const taxonomy: IssueTaxonomy =
    linkedIssue !== undefined
      ? await readIssueTaxonomy(runProcess, params.repository, linkedIssue)
      : { milestone: null, projects: [] }
  return {
    title: cleanTitle.text,
    body: cleanBody.text,
    provenanceComment,
    redacted,
    linkedIssue,
    taxonomy,
  }
}

export async function finishPrWrite(
  repository: string,
  pull: PullRef,
  prepared: PreparedPrWrite,
  createOnly: boolean,
  runProcess: RunProcess,
): Promise<PrWriteResult> {
  const comment = await upsertProvenanceComment(
    runProcess,
    repository,
    pull.number,
    prepared.provenanceComment,
    createOnly,
  )
  await applyIssueTaxonomy(runProcess, repository, pull.number, pull.nodeId, prepared.taxonomy)
  return {
    repository,
    pr: pull.number,
    url: pull.url,
    provenanceCommentId: comment.id,
    provenanceCommentUrl: comment.url,
    provenanceComment: prepared.provenanceComment,
    redacted: prepared.redacted,
    inherited: {
      issue: prepared.linkedIssue ?? null,
      milestone: prepared.taxonomy.milestone,
      projects: prepared.taxonomy.projects,
    },
  }
}
