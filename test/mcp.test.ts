import { PassThrough } from 'node:stream'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { describe, expect, it } from 'vitest'
import { getVersion } from '../src/cli/version.js'
import { POLICY_CHECK_TOOL } from '../src/mcp/policy-check.js'
import { PR_CREATE_TOOL, PR_UPDATE_TOOL, PR_VALIDATE_TOOL } from '../src/mcp/pr-tools.js'
import { startMcpServer } from '../src/mcp/server.js'

const ALL_TOOLS = [POLICY_CHECK_TOOL, PR_CREATE_TOOL, PR_UPDATE_TOOL, PR_VALIDATE_TOOL]

function readNextJsonLine(stream: PassThrough): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let buffer = ''
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const newlineIndex = buffer.indexOf('\n')
      if (newlineIndex !== -1) {
        stream.off('data', onData)
        stream.off('error', onError)
        const line = buffer.slice(0, newlineIndex).trim()
        resolve(JSON.parse(line) as Record<string, unknown>)
      }
    }
    const onError = (error: Error) => {
      stream.off('data', onData)
      reject(error)
    }
    stream.on('data', onData)
    stream.on('error', onError)
  })
}

describe('supervisor MCP server', () => {
  it('lists all tools and rejects unknown tools via MCP client', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const server = await startMcpServer(getVersion(), serverTransport)
    const client = new Client({ name: 'supervisor-test-client', version: '0.0.0' })

    try {
      await client.connect(clientTransport)
      const result = await client.listTools()
      expect(result.tools).toEqual(ALL_TOOLS)

      const unknown = await client.callTool({ name: 'does_not_exist', arguments: {} })
      expect(unknown.isError).toBe(true)
      expect(unknown.content).toEqual([{ type: 'text', text: 'Tool does_not_exist not found' }])

      // Calling with omitted arguments exercises default deps without spawning external processes.
      for (const name of ['policy_check', 'pr_create', 'pr_update', 'pr_validate']) {
        const missingArgs = await client.callTool({ name })
        expect(missingArgs.isError, name).toBe(true)
        expect(missingArgs.content, name).toEqual([
          { type: 'text', text: 'repository must be a string.' },
        ])
      }
    } finally {
      await client.close()
      await server.close()
    }
  })

  it('answers tools/list over stdio JSON-RPC framing', async () => {
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const transport = new StdioServerTransport(stdin, stdout)
    const server = await startMcpServer(getVersion(), transport)

    try {
      const initPromise = readNextJsonLine(stdout)
      stdin.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'stdio-test', version: '0.0.0' },
          },
        })}\n`,
      )
      const initResponse = await initPromise
      expect(initResponse.id).toBe(1)

      stdin.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        })}\n`,
      )

      const listPromise = readNextJsonLine(stdout)
      stdin.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        })}\n`,
      )
      const listResponse = await listPromise
      expect(listResponse.id).toBe(2)
      expect(listResponse.result).toEqual({ tools: ALL_TOOLS })
    } finally {
      await server.close()
      stdin.end()
      stdout.end()
    }
  })

  it('connects with default StdioServerTransport and closes cleanly', async () => {
    const server = await startMcpServer(getVersion())
    await server.close()
    expect(server).toBeDefined()
  })
})
