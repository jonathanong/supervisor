import { describe, expect, it } from 'vitest'
import { discoverPolicies } from '../src/policy/discover.js'
import { teamsNamed } from '../src/policy/facts-teams.js'
import type { ConditionExpr, PolicyFile } from '../src/policy/types.js'
import { check, DEV, fixture, NOBODY, policyDir } from './helpers/pull.js'

const dir = policyDir('pull-teams')

describe('team membership for supervisor policy check <owner>/<repo> <pr>', () => {
  it('finds each team a seat or a people condition names, and nothing that only looks like one', async () => {
    // The fixture also has `pr/base = 'release/v1'` and `!pr/authors`, which are not teams.
    expect(teamsNamed(await discoverPolicies(dir))).toEqual([
      'example-org/contractors',
      'example-org/core',
      'example-org/security',
    ])

    const numeric: ConditionExpr = {
      kind: 'comparison',
      lhs: { kind: 'fact', name: 'pr/authors' },
      op: '=',
      rhs: { kind: 'number', value: 1 },
    }
    const rule = { if: numeric, override: [{ if: { kind: 'literal', value: true } }] }
    expect(teamsNamed([{ rules: [rule] } as unknown as PolicyFile])).toEqual([])
  })

  it('reads the members of each team into facts.teams', async () => {
    const teams = {
      'example-org/contractors': [],
      'example-org/core': [DEV, NOBODY],
      'example-org/security': [
        { login: 'sec-lead', type: 'User' },
        { login: 'example-app[bot]', type: 'Bot' },
      ],
    }
    const result = await check(fixture({ teams }), ['--dir', dir, '--print-input'])
    expect(JSON.parse(result.stdout).facts.teams).toEqual({
      'example-org/contractors': [],
      'example-org/core': ['dev-one'],
      'example-org/security': ['sec-lead', 'bot:example-app'],
    })
    expect(result.calls.map((args) => args.slice(0, 3))).toContainEqual([
      'api',
      '--paginate',
      'orgs/example-org/teams/security/members?per_page=100',
    ])
  })

  it('fails closed, exit 2, when a team cannot be read', async () => {
    const unreadable = await check(fixture({ raw: { 'orgs/': 1 } }), ['--dir', dir])
    expect(unreadable.code).toBe(2)
    expect(unreadable.stdout).toBe('')
    expect(unreadable.stderr).toContain('teams/contractors/members?per_page=100 exited 1')
  })
})
