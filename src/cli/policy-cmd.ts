import { readFile } from 'node:fs/promises'
import { discoverPolicies, selectRulesForFile } from '../policy/discover.js'
import { evaluatePolicies } from '../policy/evaluate.js'
import type {
  EvaluationInput,
  EvaluationResult,
  PolicyFile,
  PolicyRule,
  SeatSet,
} from '../policy/types.js'
import type { CliIo } from './run.js'

const POLICY_HELP = `Usage:
  supervisor policy explain <dir> [path]
  supervisor policy check --dir <dir> --input <json> [--json] [--supervisor-policy]
`

function formatSeats(seats: SeatSet[]): string {
  if (seats.length === 0) return '0'
  return seats.map((s) => `${s.count} from [${s.from.join(', ')}]`).join('; ')
}

function formatRuleSummary(rule: PolicyRule): string {
  const verdict = rule.verdict
    ? `${rule.verdict.claude}, seats: ${formatSeats(rule.verdict.seats)}`
    : 'no verdict (advisory/findings/reuse)'
  const flags = [rule.mode, rule.nested === 'inherit' ? 'nested:inherit' : '']
    .filter(Boolean)
    .join(', ')
  return `- ${rule.purpose} [${flags}] (${rule.sourceFile})\n  paths: ${rule.paths.join(', ')}\n  verdict: ${verdict}\n  overrides: ${rule.override.length}`
}

function formatPoliciesOverview(policies: PolicyFile[]): string {
  if (policies.length === 0) return 'No policy files found.\n'
  const lines: string[] = []
  for (const policy of policies) {
    lines.push(
      `${policy.path} (mode: ${policy.mode}, nested: ${policy.nested}, rules: ${policy.rules.length})`,
    )
    for (const rule of policy.rules) {
      lines.push(`  ${formatRuleSummary(rule).replace(/\n/g, '\n  ')}`)
    }
  }
  return `${lines.join('\n')}\n`
}

function formatNextStep(result: EvaluationResult): string {
  if (result.nextStep.action === 'merge') return 'Next step: merge allowed'
  if (result.nextStep.action === 'request_review') {
    return `Next step: request review at depth ${result.nextStep.depth}`
  }
  return `Next step: escalate to a person (${result.nextStep.reason})`
}

function formatHumanCheck(result: EvaluationResult): string {
  const lines: string[] = []
  lines.push(`Verdict: ${result.verdict ?? 'none (uncovered)'}`)
  lines.push(`Review depth: ${result.reviewDepth ?? 'none'}`)
  lines.push(`Seats: ${formatSeats(result.seats)}`)
  if (result.uncoveredFiles.length > 0) {
    lines.push(`Uncovered files: ${result.uncoveredFiles.join(', ')}`)
  }
  for (const warning of result.authorOnlyWarnings) {
    lines.push(`Warning: ${warning}`)
  }
  for (const file of result.files) {
    const ruleNames = file.rules.map((r) => `${r.purpose} -> ${r.verdict.claude}`).join('; ')
    lines.push(`- ${file.file}: ${file.covered ? ruleNames || 'no rule applies' : 'uncovered'}`)
  }
  lines.push(formatNextStep(result))
  return `${lines.join('\n')}\n`
}

async function runExplain(args: string[], io: CliIo): Promise<number> {
  if (args.length < 1 || args.length > 2) {
    io.stderr(POLICY_HELP)
    return 2
  }
  const [dir, targetPath] = args as [string, string | undefined]
  let policies: PolicyFile[]
  try {
    policies = await discoverPolicies(dir)
  } catch (err) {
    io.stderr(`${(err as Error).message}\n`)
    return 2
  }
  if (!targetPath) {
    io.stdout(formatPoliciesOverview(policies))
    return 0
  }
  const { decidingPolicy, rules } = selectRulesForFile(policies, targetPath)
  if (!decidingPolicy || rules.length === 0) {
    io.stdout(`Path: ${targetPath}\nUncovered (no enforcing policy rule matches).\n`)
    return 0
  }
  const lines = [`Path: ${targetPath}`, `Deciding policy: ${decidingPolicy.path}`]
  for (const rule of rules) {
    lines.push(formatRuleSummary(rule))
  }
  io.stdout(`${lines.join('\n')}\n`)
  return 0
}

async function runCheck(args: string[], io: CliIo): Promise<number> {
  let dir: string | undefined
  let inputPath: string | undefined
  let asJson = false
  let supervisorPolicy = false

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!
    if (arg === '--dir' && i + 1 < args.length) {
      dir = args[++i]
    } else if (arg === '--input' && i + 1 < args.length) {
      inputPath = args[++i]
    } else if (arg === '--json') {
      asJson = true
    } else if (arg === '--supervisor-policy') {
      supervisorPolicy = true
    } else {
      io.stderr(`Unknown or incomplete option: ${arg}\n${POLICY_HELP}`)
      return 2
    }
  }
  if (!dir || !inputPath) {
    io.stderr(`Both --dir and --input are required.\n${POLICY_HELP}`)
    return 2
  }

  let policies: PolicyFile[]
  try {
    policies = await discoverPolicies(dir, { supervisorPolicy })
  } catch (err) {
    io.stderr(`${(err as Error).message}\n`)
    return 2
  }

  let input: EvaluationInput
  try {
    const raw = JSON.parse(await readFile(inputPath, 'utf8')) as unknown
    if (
      typeof raw !== 'object' ||
      raw === null ||
      !Array.isArray((raw as EvaluationInput).changedFiles)
    ) {
      io.stderr('Input JSON must be an object with a changedFiles array\n')
      return 2
    }
    input = raw as EvaluationInput
  } catch (err) {
    io.stderr(`Cannot read input JSON: ${(err as Error).message}\n`)
    return 2
  }

  const result = evaluatePolicies(policies, input)
  io.stdout(asJson ? `${JSON.stringify(result, null, 2)}\n` : formatHumanCheck(result))
  return result.nextStep.action === 'merge' ? 0 : 1
}

export async function runPolicyCommand(args: string[], io: CliIo): Promise<number> {
  const [subcommand, ...rest] = args
  if (subcommand === 'explain') return await runExplain(rest, io)
  if (subcommand === 'check') return await runCheck(rest, io)
  io.stderr(`Unknown policy subcommand: ${subcommand ?? '(none)'}\n${POLICY_HELP}`)
  return 2
}
