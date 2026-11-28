import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { shepherdStatus as defaultShepherdStatus } from '../cli/shepherd-status.js'
import type { ShepherdStatus } from '../policy/facts-readiness.js'
import type { PullCheckDeps } from '../policy/run-check.js'
import { runProcess as defaultRunProcess, type RunProcess } from '../state/process.js'
import { handlePolicyCheck, POLICY_CHECK_TOOL } from './policy-check.js'
import {
  handlePrCreate,
  handlePrUpdate,
  handlePrValidate,
  PR_CREATE_TOOL,
  PR_UPDATE_TOOL,
  PR_VALIDATE_TOOL,
} from './pr-tools.js'

export interface McpServerDeps {
  env?: Record<string, string | undefined>
  cwd?: string
  runProcess?: RunProcess
  shepherdStatus?: ShepherdStatus
}

const TOOLS = [POLICY_CHECK_TOOL, PR_CREATE_TOOL, PR_UPDATE_TOOL, PR_VALIDATE_TOOL]

function resolveDeps(deps: McpServerDeps): PullCheckDeps {
  return {
    env: deps.env ?? process.env,
    cwd: deps.cwd ?? process.cwd(),
    runProcess: deps.runProcess ?? defaultRunProcess,
    shepherdStatus: deps.shepherdStatus ?? defaultShepherdStatus,
  }
}

export function createMcpServer(version: string, deps: McpServerDeps = {}): McpServer {
  const server = new McpServer({ name: 'supervisor', version })
  server.server.registerCapabilities({ tools: {} })
  server.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: TOOLS,
  }))
  server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = request.params.arguments ?? {}
    if (request.params.name === POLICY_CHECK_TOOL.name) {
      return await handlePolicyCheck(args, resolveDeps(deps))
    }
    if (request.params.name === PR_CREATE_TOOL.name) {
      return await handlePrCreate(args, resolveDeps(deps))
    }
    if (request.params.name === PR_UPDATE_TOOL.name) {
      return await handlePrUpdate(args, resolveDeps(deps))
    }
    if (request.params.name === PR_VALIDATE_TOOL.name) {
      return await handlePrValidate(args, resolveDeps(deps))
    }
    return {
      content: [{ type: 'text', text: `Tool ${request.params.name} not found` }],
      isError: true,
    }
  })
  return server
}

export async function startMcpServer(
  version: string,
  transport?: Transport,
  deps: McpServerDeps = {},
): Promise<McpServer> {
  const server = createMcpServer(version, deps)
  await server.connect(transport ?? new StdioServerTransport())
  return server
}
