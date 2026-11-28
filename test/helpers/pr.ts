import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { getVersion } from '../../src/cli/version.js'
import { startMcpServer, type McpServerDeps } from '../../src/mcp/server.js'
import type { ProcessResult, RunProcess } from '../../src/state/process.js'

const exampleConfigPath = fileURLToPath(
  new URL('../../examples/config.example.json', import.meta.url),
)

export const VALID_TITLE = 'Add MCP PR tools with provenance comments'
export const VALID_BODY = [
  '## Problem',
  '',
  'Agents lacked MCP tools to validate and write pull request descriptions.',
  '',
  '## Change',
  '',
  'Add pr_create, pr_update, and pr_validate with fixed provenance comments.',
  '',
  '## Verification',
  '',
  'Ran unit tests and the skill-to-validator contract test.',
].join('\n')

export const VALID_PROVENANCE = {
  harness: 'claude-code',
  version: '2.1.0',
  models: ['claude-sonnet-4-6'],
  session: 'session-123',
  role: 'author',
  fields: { machine: 'workstation-1' },
}

export const VALID_COMMENT = [
  '<!-- supervisor:provenance v1 -->',
  '- harness: claude-code',
  '- version: 2.1.0',
  '- models: claude-sonnet-4-6',
  '- session: session-123',
  '- role: author',
  '- machine: workstation-1',
].join('\n')

export async function writePrConfig(
  dir: string,
  name: string,
  overrides: {
    provenance?: { fields: string[] }
    scopes?: Array<Record<string, unknown>>
  } = {},
): Promise<string> {
  const raw = JSON.parse(await readFile(exampleConfigPath, 'utf8')) as Record<string, unknown>
  const config = {
    ...raw,
    provenance: overrides.provenance ?? { fields: ['machine'] },
    scopes: overrides.scopes ?? [
      {
        owner: 'example-org',
        kind: 'org',
        repos: '*',
        excludedRepos: ['excluded-repo'],
        provenance: { fields: ['machine'] },
      },
      {
        owner: 'example-org',
        kind: 'org',
        repos: ['excluded-repo'],
        provenance: { fields: ['worktree'] },
      },
      {
        owner: 'example-user',
        kind: 'user',
        repos: ['plain-repo'],
        provenance: { fields: [] },
      },
    ],
  }
  const path = join(dir, name)
  await writeFile(path, JSON.stringify(config))
  return path
}

export interface RecordedGhCall {
  command: string
  args: string[]
}

export type GhRouteHandler = (args: string[]) => ProcessResult | Promise<ProcessResult>

export function createFakeGh(handler: GhRouteHandler): {
  run: RunProcess
  calls: RecordedGhCall[]
} {
  const calls: RecordedGhCall[] = []
  const run: RunProcess = async (command, args) => {
    calls.push({ command, args })
    return await handler(args)
  }
  return { run, calls }
}

export function okJson(value: unknown): ProcessResult {
  return { code: 0, stdout: `${JSON.stringify(value)}\n`, stderr: '' }
}

export async function callMcpTool(
  name: string,
  args: Record<string, unknown> | undefined,
  deps: McpServerDeps = {},
) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = await startMcpServer(getVersion(), serverTransport, deps)
  const client = new Client({ name: 'supervisor-test-client', version: '0.0.0' })
  try {
    await client.connect(clientTransport)
    return await client.callTool(args === undefined ? { name } : { name, arguments: args })
  } finally {
    await client.close()
    await server.close()
  }
}

export function getFieldArg(args: string[], key: string): string | undefined {
  for (let i = 0; i < args.length - 1; i++) {
    if ((args[i] === '-f' || args[i] === '-F') && args[i + 1]!.startsWith(`${key}=`)) {
      return args[i + 1]!.slice(key.length + 1)
    }
  }
  return undefined
}
