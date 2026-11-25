import { describe, expect, it } from 'vitest'
import { parsePolicySource } from '../src/policy/load.js'
import { PolicyLoadError } from '../src/policy/types.js'

function expectErr(source: string, match: string): void {
  try {
    parsePolicySource(source)
    expect.unreachable(`Expected error matching '${match}'`)
  } catch (err) {
    expect(err).toBeInstanceOf(PolicyLoadError)
    expect((err as PolicyLoadError).message).toContain(match)
  }
}

describe('policy locals and use validation', () => {
  it('validates locals, use maps, and condition local expansion', () => {
    expectErr(
      'version: 1\nrules:\n  - purpose: bad\n    use: not-list\n    paths: ["**"]\n    verdict: { claude: approves, seats: 0 }\n',
      'use must be a list',
    )
    const nine = Array.from({ length: 9 }, (_, i) => `@l${i}`)
    expectErr(
      `version: 1\nrules:\n  - purpose: bad\n    use: ${JSON.stringify(nine)}\n    paths: ["**"]\n    verdict: { claude: approves, seats: 0 }\n`,
      'maximum of 8',
    )
    expectErr(
      'version: 1\nrules:\n  - purpose: bad\n    use: [plain]\n    paths: ["**"]\n    verdict: { claude: approves, seats: 0 }\n',
      '@name string',
    )
    expectErr(
      'version: 1\nrules:\n  - purpose: bad\n    use: ["@missing"]\n    paths: ["**"]\n    verdict: { claude: approves, seats: 0 }\n',
      "Unknown local '@missing'",
    )
    expectErr(
      'version: 1\nlocals: { x: 42 }\nrules:\n  - purpose: bad\n    use: ["@x"]\n    paths: ["**"]\n    verdict: { claude: approves, seats: 0 }\n',
      'must hold a map',
    )
    expectErr(
      'version: 1\nlocals: { m: { mode: observe } }\nrules:\n  - purpose: bad\n    use: ["@m"]\n    paths: ["**"]\n    verdict: { claude: approves, seats: 0 }\n',
      "Key 'mode' is not allowed",
    )
    expectErr(
      'version: 1\nlocals: { badlist: [123] }\nrules:\n  - purpose: bad\n    paths: ["**", "!@badlist"]\n    verdict: { claude: approves, seats: 0 }\n',
      'must hold strings',
    )
    expectErr(
      'version: 1\nlocals: { n: 123 }\nrules:\n  - purpose: bad\n    paths: ["@n"]\n    verdict: { claude: approves, seats: 0 }\n',
      'must be a string',
    )
    expectErr(
      'version: 1\nrules:\n  - purpose: bad\n    paths: ["!@missing", "@missing"]\n    verdict: { claude: approves, seats: 0 }\n',
      "Unknown local '@missing'",
    )
    expectErr(
      'version: 1\nrules:\n  - purpose: bad\n    paths: [123]\n    verdict: { claude: approves, seats: 0 }\n',
      'Expected string',
    )
    expectErr(
      'version: 1\nlocals: { obj: { a: 1 } }\nrules:\n  - purpose: bad\n    if: "@obj = 1"\n    paths: ["**"]\n    verdict: { claude: approves, seats: 0 }\n',
      'cannot be used in a condition',
    )
    expectErr(
      'version: 1\nrules:\n  - purpose: bad\n    if: "@nope = 1"\n    paths: ["**"]\n    verdict: { claude: approves, seats: 0 }\n',
      "Unknown local '@nope'",
    )

    const ok = parsePolicySource(`
version: 1
locals:
  single: 'docs/**'
  arr: ['alice', 'bob']
  num: 5
rules:
  - purpose: Scalar and array locals in paths, people, and conditions
    if: 'pr/files_changed <= @num AND ANY pr/authors = @arr AND pr/base = \\@literal AND pr/opened_by = a@b'
    paths: ['@single', '!@single', 'src/**']
    verdict:
      claude: comments
      seats:
        - count: 1
          from: ['\\@alice']
`)
    expect(ok.rules[0]!.verdict!.seats[0]!.from).toEqual(['@alice'])
  })

  it('validates people, seats, verdict, and max_age errors', () => {
    expectErr('version: 1\nrules: [123]\n', 'Rule must be an object')
    expectErr(
      'version: 1\nrules:\n  - purpose: ""\n    paths: ["**"]\n    verdict: { claude: approves, seats: 0 }\n',
      'single non-empty line',
    )
    expectErr(
      `version: 1\nrules:\n  - purpose: "${'a'.repeat(1001)}"\n    paths: ["**"]\n    verdict: { claude: approves, seats: 0 }\n`,
      '1000 characters',
    )
    expectErr(
      'version: 1\nrules:\n  - purpose: ok\n    paths: ["/bad", "!docs/**"]\n    verdict: { claude: approves, seats: 0 }\n',
      'leading or trailing slash',
    )
    expectErr(
      'version: 1\nrules:\n  - purpose: ok\n    if: 123\n    paths: ["**"]\n    verdict: { claude: approves, seats: 0 }\n',
      'boolean or string',
    )
    expectErr(
      'version: 1\nrules:\n  - purpose: ok\n    paths: ["**"]\n    verdict: 123\n',
      'verdict must be an object',
    )
    expectErr(
      'version: 1\nrules:\n  - purpose: ok\n    paths: ["**"]\n    verdict: { claude: invalid }\n',
      "'approves', 'comments', or 'blocks'",
    )
    expectErr(
      'version: 1\nrules:\n  - purpose: ok\n    paths: ["**"]\n    verdict: {}\n',
      'verdict.claude is required',
    )
    expectErr(
      'version: 1\nrules:\n  - purpose: ok\n    paths: ["**"]\n    verdict: { claude: approves }\n',
      'verdict.seats is required',
    )
    expectErr(
      'version: 1\nrules:\n  - purpose: ok\n    paths: ["**"]\n    verdict: { claude: approves, seats: 0, max_age: 10 }\n',
      'duration string',
    )
    expectErr(
      'version: 1\nrules:\n  - purpose: ok\n    paths: ["**"]\n    verdict: { claude: approves, seats: 0, max_age: "bad" }\n',
      'Invalid max_age',
    )
    expectErr(
      'version: 1\nrules:\n  - purpose: ok\n    paths: ["**"]\n    verdict: { claude: approves, seats: "bad" }\n',
      'integer or a list',
    )
    expectErr(
      `version: 1\nrules:\n  - purpose: ok\n    paths: ["**"]\n    verdict: { claude: approves, seats: ${JSON.stringify(Array.from({ length: 9 }, () => ({ count: 1, from: 'humans' })))} }\n`,
      'maximum of 8 sets',
    )
    expectErr(
      'version: 1\nrules:\n  - purpose: ok\n    paths: ["**"]\n    verdict: { claude: approves, seats: [123] }\n',
      'Seat set must be an object',
    )
    expectErr(
      'version: 1\nrules:\n  - purpose: ok\n    paths: ["**"]\n    verdict: { claude: approves, seats: [{ count: 0, from: humans }] }\n',
      'from 1 to 16',
    )
    expectErr(
      'version: 1\nrules:\n  - purpose: ok\n    paths: ["**"]\n    verdict: { claude: approves, seats: [{ count: 1, from: [] }] }\n',
      'must not be empty',
    )
    expectErr(
      'version: 1\nrules:\n  - purpose: ok\n    paths: ["**"]\n    verdict: { claude: approves, seats: [{ count: 1, from: ["<login>", "! ", nobody, pr/approved_by] }] }\n',
      'Placeholder',
    )
    expectErr(
      'version: 1\nrules:\n  - purpose: ok\n    paths: ["**"]\n    verdict: { claude: approves, seats: [{ count: 1, from: ["!alice"] }] }\n',
      'non-negated item',
    )
    const elevenTeams = Array.from({ length: 11 }, (_, i) => `org/t${i}`)
    expectErr(
      `version: 1\nrules:\n  - purpose: ok\n    paths: ["**"]\n    verdict: { claude: approves, seats: [{ count: 1, from: ${JSON.stringify(elevenTeams)} }] }\n`,
      'maximum of 10 teams',
    )
    const manyEntries = Array.from({ length: 1025 }, (_, i) => `u${i}`)
    expectErr(
      `version: 1\nrules:\n  - purpose: ok\n    paths: ["**"]\n    verdict: { claude: approves, seats: [{ count: 1, from: ${JSON.stringify(manyEntries)} }] }\n`,
      '1024 entries',
    )
  })
})
