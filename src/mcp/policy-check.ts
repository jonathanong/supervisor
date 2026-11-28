import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import { FactsError } from '../policy/facts-gh.js'
import { runConfiguredPullCheck, type PullCheckDeps } from '../policy/run-check.js'

const ALLOWED_ARGS = new Set(['repository', 'pr'])

export const POLICY_CHECK_TOOL: Tool = {
  name: 'policy_check',
  description:
    'Read a pull request from GitHub, evaluate the configured supervisor merge policy (and repository policy from checkoutRoot when present) for its current head, and ask pr-shepherd (read-only) whether the head is ready to merge. Returns the same result as `supervisor policy check <owner>/<repo> <pr> --dir <policy-dir> --supervisor-policy [--repo-dir <checkout>] --json`: verdict, seats, review depth, readiness, blockers, and next step.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['repository', 'pr'],
    properties: {
      repository: {
        type: 'string',
        description: 'Target repository as <owner>/<repo>.',
      },
      pr: {
        type: 'integer',
        minimum: 1,
        description: 'Pull request number.',
      },
    },
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
}

function parsePolicyCheckArgs(raw: Record<string, unknown>): { repository: string; pr: number } {
  const unknown = Object.keys(raw).filter((key) => !ALLOWED_ARGS.has(key))
  if (unknown.length > 0) throw new FactsError(`Unknown argument: ${unknown.join(', ')}.`)
  if (typeof raw.repository !== 'string') throw new FactsError('repository must be a string.')
  if (typeof raw.pr !== 'number') throw new FactsError('pr must be an integer.')
  return { repository: raw.repository, pr: raw.pr }
}

export async function handlePolicyCheck(
  rawArgs: Record<string, unknown>,
  deps: PullCheckDeps,
): Promise<CallToolResult> {
  try {
    const { repository, pr } = parsePolicyCheckArgs(rawArgs)
    const result = await runConfiguredPullCheck(repository, pr, deps)
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      structuredContent: result as unknown as Record<string, unknown>,
    }
  } catch (err) {
    return {
      content: [{ type: 'text', text: (err as Error).message }],
      isError: true,
    }
  }
}
