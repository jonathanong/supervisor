import { discoverPolicies, selectRulesForFile } from '../policy/discover.js'
import { loadLayeredPolicies } from '../policy/layers.js'
import type { PolicyFile } from '../policy/types.js'
import { runCheck } from './policy-check.js'
import { runClassify } from './policy-classify.js'
import { requiredAlwaysHumanFromConfig } from './policy-required.js'
import { formatPoliciesOverview, formatRuleSummary } from './policy-format.js'
import type { CliIo } from './run.js'

const POLICY_HELP = `Usage:
  supervisor policy explain <dir> [path] [--repo-dir <checkout>]
  supervisor policy check <owner>/<repo> <pr> --dir <dir> [--supervisor-policy] [--json]
                          [--classifiers <json>] [--print-input] [--repo-dir <checkout>]
  supervisor policy check --dir <dir> --input <json> [--supervisor-policy] [--json]
                          [--repo-dir <checkout>]
  supervisor policy classify-prepare <owner>/<repo> <pr> --dir <dir> --out <out dir>
                          [--supervisor-policy] [--repo-dir <checkout>]
  supervisor policy classify-collect --out <out dir>

classify-prepare reads the pull request's head and diff with \`gh api\`, finds the repo/<name>
classifiers the policies in <dir> name, and writes for each one input file <out dir>/<name>.md
(its question and the diff, nothing else about the pull request) and the path its answer goes to.
It prints <out dir>/manifest.json. A classifier whose definition cannot be loaded is listed with
its error and gets no input file. A diff too large for GitHub to return whole fails the command.
An agent answers each input file with one JSON object, {"<output>": <value>, ...}, written to
the answer path. classify-collect checks each answer against the outputs the definition allows,
writes the valid ones to <out dir>/classifiers.json for check --classifiers, and prints its path.
An answer that is missing or not allowed is left out, with the reason on stderr. It exits 1,
writing nothing, when the pull request has a new head since classify-prepare.

check <owner>/<repo> <pr> reads the pull request from GitHub with \`gh api\`: its current head,
changed files, authors, labels and approvals of that head. It evaluates the policies in <dir>,
then asks pr-shepherd (read-only: it changes nothing on GitHub) whether it would merge that
head. The next step is merge only when the policy allows it and pr-shepherd says the head is
ready. When the policy allows the merge but pr-shepherd does not, the next step is shepherd:
run pr-shepherd on the pull request. A pending check needs no person. A blocker, such as a
draft or a closed pull request, escalates.

pr-shepherd reads its .pr-shepherdrc.yml from the target repository's checkout. Pass it with
--repo-dir; without --repo-dir it reads the config from the current directory.

  --classifiers <json>  Classifier results to evaluate with: {"<name>": {"status": ...}}.
                        Without it no classifier has a result.
  --print-input         Print the collected input as JSON and do not evaluate.
  --input <json>        Evaluate a written input file instead of a pull request.
  --repo-dir <checkout> Treat <dir> as the supervisor policy and add the repository's own
                        .supervisor/approvals.yml files from a default-branch checkout. Also
                        the directory pr-shepherd reads its config from (default: the
                        current directory).

Exit codes: 0 the next step is merge (or --print-input printed the input), 1 it is not,
2 the pull request, the policies or the input could not be read.
`

async function runExplain(args: string[], io: CliIo): Promise<number> {
  const flag = args.indexOf('--repo-dir')
  const repoDir = flag === -1 ? undefined : args.splice(flag, 2)[1]
  if (args.length < 1 || args.length > 2 || (flag !== -1 && !repoDir)) {
    io.stderr(POLICY_HELP)
    return 2
  }
  const [dir, targetPath] = args as [string, string | undefined]
  let policies: PolicyFile[]
  try {
    policies = repoDir
      ? await loadLayeredPolicies(dir, repoDir, {
          requiredAlwaysHuman: await requiredAlwaysHumanFromConfig(io.env, process.cwd()),
        })
      : await discoverPolicies(dir)
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

export async function runPolicyCommand(args: string[], io: CliIo): Promise<number> {
  const [subcommand, ...rest] = args
  if (subcommand === 'explain') return await runExplain(rest, io)
  if (subcommand === 'check') return await runCheck(rest, io, POLICY_HELP)
  if (subcommand === 'classify-prepare') return await runClassify('prepare', rest, io, POLICY_HELP)
  if (subcommand === 'classify-collect') return await runClassify('collect', rest, io, POLICY_HELP)
  io.stderr(`Unknown policy subcommand: ${subcommand ?? '(none)'}\n${POLICY_HELP}`)
  return 2
}
