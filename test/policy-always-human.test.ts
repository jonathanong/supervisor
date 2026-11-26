import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { loadReferencePolicy } from '../scripts/merge-classification/main.js'
import {
  DEFAULT_ALWAYS_HUMAN,
  assertAlwaysHumanRules,
  type AlwaysHumanRequirement,
} from '../src/policy/always-human.js'
import { discoverPolicies } from '../src/policy/discover.js'
import { loadLayeredPolicies } from '../src/policy/layers.js'
import { parsePolicySource } from '../src/policy/load.js'
import { PolicyLoadError } from '../src/policy/types.js'

const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/policies/layered/${name}`, import.meta.url))
const CATCH_ALL = `version: 1
rules:
  - purpose: Everything goes to a person.
    paths: ['**']
    verdict: { claude: comments, seats: 1 }
`
const workflows: AlwaysHumanRequirement[] = [
  { name: 'CI workflow definitions', samples: ['.github/workflows/ci.yml'] },
]
const tempDirs: string[] = []

async function policyDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'supervisor-always-human-'))
  tempDirs.push(dir)
  for (const [folder, source] of Object.entries(files)) {
    await mkdir(join(dir, folder), { recursive: true })
    await writeFile(join(dir, folder, 'approvals.yml'), source)
  }
  return dir
}

/** Checks a policy whose only candidate rule for the workflow paths is `rule`. */
function check(rule: string, top = ''): void {
  const policy = parsePolicySource(`${top}${CATCH_ALL}  - purpose: Candidate\n${rule}`)
  assertAlwaysHumanRules(policy, 'policy.yml', workflows)
}

describe('always-human rules a supervisor policy must have', () => {
  afterEach(async () => {
    while (tempDirs.length > 0) await rm(tempDirs.pop()!, { recursive: true, force: true })
  })

  it('refuses a supervisor policy without them and names every missing path', async () => {
    const dir = await policyDir({ '.claude': CATCH_ALL })
    const load = discoverPolicies(dir, { supervisorPolicy: true })
    await expect(load).rejects.toThrow(PolicyLoadError)
    const { errors } = (await load.catch((err: unknown) => err)) as PolicyLoadError

    expect(errors.map((e) => e.file)).toEqual(Array(5).fill('.claude/approvals.yml'))
    expect(errors.map((e) => e.message.split(' to a person')[0])).toEqual(
      DEFAULT_ALWAYS_HUMAN.map((r) => `Supervisor policy must send ${r.name}`),
    )
    expect(errors[0]!.message).toBe(
      "Supervisor policy must send CI workflow definitions to a person: no rule with 'nested: inherit', no 'if' and a verdict that blocks or asks for a human seat matches '.github/workflows/ci.yml'",
    )
    await expect(loadLayeredPolicies(dir, fixture('repo-plain'))).rejects.toThrow('release paths')

    // The same file is a valid repository policy, and the list is a parameter.
    expect(await discoverPolicies(dir)).toHaveLength(1)
    const none = { supervisorPolicy: true, requiredAlwaysHuman: [] }
    expect(await discoverPolicies(dir, none)).toHaveLength(1)
    expect(await loadLayeredPolicies(dir, fixture('repo-plain'), none)).toHaveLength(1)
  })

  it('loads a supervisor policy that has them, the eval reference policy included', async () => {
    const policies = await discoverPolicies(fixture('supervisor'), { supervisorPolicy: true })
    expect(policies).toHaveLength(1)
    expect(await loadReferencePolicy()).toHaveLength(2)
    // A directory with no supervisor policy at all is refused, not loaded as an empty policy.
    const empty = discoverPolicies(fixture('repo-plain'), { supervisorPolicy: true })
    await expect(empty).rejects.toThrow('has no .claude/approvals.yml')
  })

  it('takes the required paths as a parameter', async () => {
    const payments = [{ name: 'payments', samples: ['services/payments/charge.ts'] }]
    const opts = { requiredAlwaysHuman: payments }
    const repoDir = fixture('repo-plain')
    await expect(loadLayeredPolicies(fixture('supervisor'), repoDir, opts)).rejects.toThrow(
      "must send payments to a person: no rule with 'nested: inherit', no 'if' and a verdict that blocks or asks for a human seat matches 'services/payments/charge.ts'",
    )

    const rule = `  - purpose: Payments always go to a person.
    paths: ['**/payments/**']
    nested: inherit
    verdict: { claude: blocks }
`
    const dir = await policyDir({ '.claude': `${CATCH_ALL}${rule}` })
    expect(await loadLayeredPolicies(dir, repoDir, opts)).toHaveLength(1)
  })

  it('needs the rules in the root file, where every repository inherits them', async () => {
    const dir = await policyDir({ 'packages/app/.claude': CATCH_ALL })
    const load = discoverPolicies(dir, { supervisorPolicy: true, requiredAlwaysHuman: workflows })
    const { errors } = (await load.catch((err: unknown) => err)) as PolicyLoadError
    expect(errors.map((e) => e.file)).toEqual([dir])
  })

  it('counts only a rule that holds everywhere and never approves', () => {
    const paths = "    paths: ['.github/workflows/**']\n"
    const person = '    verdict: { claude: comments, seats: 1 }\n'
    const inherit = '    nested: inherit\n'
    const holds = [
      `${paths}${inherit}${person}`,
      `${paths}${inherit}    verdict: { claude: blocks }\n`,
      `${paths}${inherit}${person}    override:\n      - { if: 'pr/diff_lines > 5', verdict: { seats: 2 } }\n`,
    ]
    for (const rule of holds) expect(() => check(rule), rule).not.toThrow()
    expect(() => check(`${paths}${person}`, 'nested: inherit\n')).not.toThrow()

    const fails = [
      `${paths}${person}`,
      `${paths}${inherit}    verdict: { claude: approves, seats: 1 }\n`,
      `${paths}${inherit}    if: 'pr/diff_lines > 5'\n${person}`,
      `${paths}${inherit}    if: false\n${person}`,
      `${paths}${inherit}${person}    override:\n      - { if: 'pr/diff_lines < 5', verdict: { claude: approves } }\n`,
      `${paths}${inherit}    mode: observe\n${person}`,
      `${paths}${inherit}    findings: { resolution: nobody }\n`,
      `    paths: ['.github/workflows/*.yaml']\n${inherit}${person}`,
      // A rule that comments and asks nobody, or only a bot, does not go to a person.
      `${paths}${inherit}    verdict: { claude: comments, seats: [] }\n`,
      `${paths}${inherit}    verdict: { claude: comments, seats: [{ count: 1, from: ['bot:example-reviewer'] }] }\n`,
      `${paths}${inherit}    verdict: { claude: comments, seats: [{ count: 0, from: [humans] }] }\n`,
      `${paths}${inherit}${person}    override:\n      - { if: 'pr/diff_lines < 5', verdict: { seats: [] } }\n`,
    ]
    for (const rule of fails) expect(() => check(rule), rule).toThrow(PolicyLoadError)
    expect(() => check(`${paths}${inherit}${person}`, 'mode: observe\n')).toThrow(PolicyLoadError)
  })
})
