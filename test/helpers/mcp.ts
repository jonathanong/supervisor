import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { expect } from 'vitest'
import { getVersion } from '../../src/cli/version.js'
import { startMcpServer, type McpServerDeps } from '../../src/mcp/server.js'
import { fakeGh, type GhFixture } from './pull.js'

const exampleConfigPath = fileURLToPath(
  new URL('../../examples/config.example.json', import.meta.url),
)

export async function callPolicyCheck(
  gh: GhFixture,
  args: Record<string, unknown>,
  extraDeps: Pick<McpServerDeps, 'env' | 'cwd'> = {},
) {
  const { run, calls } = fakeGh(gh)
  const shepherdCalls: string[][] = []
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = await startMcpServer(getVersion(), serverTransport, {
    env: extraDeps.env ?? {},
    cwd: extraDeps.cwd ?? process.cwd(),
    runProcess: run,
    shepherdStatus: async (pull, cwd) => {
      shepherdCalls.push([pull, cwd])
      if (gh.shepherd instanceof Error) throw gh.shepherd
      return gh.shepherd
    },
  })
  const client = new Client({ name: 'supervisor-test-client', version: '0.0.0' })
  try {
    await client.connect(clientTransport)
    const response = await client.callTool({ name: 'policy_check', arguments: args })
    return { response, calls, shepherdCalls }
  } finally {
    await client.close()
    await server.close()
  }
}

export function textContent(response: Record<string, unknown>): string {
  const blocks = response.content as Array<{ type: string; text: string }>
  expect(blocks).toHaveLength(1)
  expect(blocks[0]!.type).toBe('text')
  return blocks[0]!.text
}

export interface PolicyConfigOptions {
  policy: string
  requiredAlwaysHuman?: Array<{ name: string; samples: string[] }>
  scopes?: Array<Record<string, unknown>>
}

export async function writePolicyConfig(
  dir: string,
  name: string,
  options: PolicyConfigOptions,
): Promise<string> {
  const raw = JSON.parse(await readFile(exampleConfigPath, 'utf8')) as {
    mergeAuthority: Record<string, unknown>
    scopes: Array<Record<string, unknown>>
  }
  const config = {
    ...raw,
    ...(options.scopes !== undefined ? { scopes: options.scopes } : {}),
    mergeAuthority: {
      ...raw.mergeAuthority,
      policy: options.policy,
      ...(options.requiredAlwaysHuman !== undefined
        ? { requiredAlwaysHuman: options.requiredAlwaysHuman }
        : {}),
    },
  }
  const path = join(dir, name)
  await writeFile(path, JSON.stringify(config))
  return path
}
