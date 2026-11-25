import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

export function createMcpServer(version: string): McpServer {
  return new McpServer({ name: 'supervisor', version }, { capabilities: { tools: {} } })
}

export async function startMcpServer(version: string, transport?: Transport): Promise<McpServer> {
  const server = createMcpServer(version)
  await server.connect(transport ?? new StdioServerTransport())
  return server
}
