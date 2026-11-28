import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { resolveProvenanceFields } from '../config/provenance.js'
import { PrToolError } from '../pr/gh-client.js'
import { createPull, readDefaultBranch, readPull, updatePull } from '../pr/github.js'
import { renderProvenanceComment } from '../pr/provenance.js'
import { validatePr } from '../pr/validate.js'
import { finishPrWrite, preparePrWrite } from '../pr/write.js'
import type { RunProcess } from '../state/process.js'
import { parsePrCreateArgs, parsePrUpdateArgs, parsePrValidateArgs } from './pr-args.js'

export { PR_CREATE_TOOL, PR_UPDATE_TOOL, PR_VALIDATE_TOOL } from './pr-schemas.js'
export type { PrWriteResult } from '../pr/write.js'

export interface PrToolDeps {
  env: Record<string, string | undefined>
  cwd: string
  runProcess: RunProcess
}

function okResult(value: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value as Record<string, unknown>,
  }
}

function errorResult(err: unknown): CallToolResult {
  const structured =
    err instanceof PrToolError ? { code: err.code, ...err.details } : { code: 'unexpected-error' }
  return {
    content: [{ type: 'text', text: (err as Error).message }],
    structuredContent: structured,
    isError: true,
  }
}

export async function handlePrValidate(
  rawArgs: Record<string, unknown>,
  deps: PrToolDeps,
): Promise<CallToolResult> {
  try {
    const args = parsePrValidateArgs(rawArgs)
    const { extraFields } = await resolveProvenanceFields(deps.env, deps.cwd, args.repository)
    const provenanceComment =
      args.provenanceComment ?? renderProvenanceComment(args.provenance!, extraFields)
    const result = validatePr({
      title: args.title,
      body: args.body,
      provenanceComment,
      extraFields,
    })
    return okResult(result)
  } catch (err) {
    return errorResult(err)
  }
}

export async function handlePrCreate(
  rawArgs: Record<string, unknown>,
  deps: PrToolDeps,
): Promise<CallToolResult> {
  try {
    const args = parsePrCreateArgs(rawArgs)
    const { extraFields } = await resolveProvenanceFields(deps.env, deps.cwd, args.repository)
    const prepared = await preparePrWrite(
      {
        repository: args.repository,
        title: args.title,
        body: args.body,
        ...(args.issue !== undefined ? { issue: args.issue } : {}),
        provenance: args.provenance,
        extraFields,
      },
      deps.runProcess,
    )
    const base = args.base ?? (await readDefaultBranch(deps.runProcess, args.repository))
    const pull = await createPull(deps.runProcess, args.repository, {
      title: prepared.title,
      body: prepared.body,
      head: args.head,
      base,
      draft: args.draft,
    })
    try {
      return okResult(await finishPrWrite(args.repository, pull, prepared, true, deps.runProcess))
    } catch (err) {
      throw new PrToolError(
        'pr-partially-written',
        `PR #${pull.number} was opened at ${pull.url}, but a later step failed: ${(err as Error).message} Do not call pr_create again; finish with pr_update.`,
        { cause: err, details: { repository: args.repository, pr: pull.number, url: pull.url } },
      )
    }
  } catch (err) {
    return errorResult(err)
  }
}

export async function handlePrUpdate(
  rawArgs: Record<string, unknown>,
  deps: PrToolDeps,
): Promise<CallToolResult> {
  try {
    const args = parsePrUpdateArgs(rawArgs)
    const { extraFields } = await resolveProvenanceFields(deps.env, deps.cwd, args.repository)
    const existing =
      args.title === undefined || args.body === undefined
        ? await readPull(deps.runProcess, args.repository, args.pr)
        : undefined
    const prepared = await preparePrWrite(
      {
        repository: args.repository,
        title: args.title ?? existing!.title,
        body: args.body ?? existing!.body,
        ...(args.issue !== undefined ? { issue: args.issue } : {}),
        provenance: args.provenance,
        extraFields,
      },
      deps.runProcess,
    )
    const pull =
      existing !== undefined && args.title === undefined && args.body === undefined
        ? existing
        : await updatePull(deps.runProcess, args.repository, args.pr, {
            ...(args.title !== undefined ? { title: prepared.title } : {}),
            ...(args.body !== undefined ? { body: prepared.body } : {}),
          })
    return okResult(await finishPrWrite(args.repository, pull, prepared, false, deps.runProcess))
  } catch (err) {
    return errorResult(err)
  }
}
