import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { discoverPolicies } from '../../src/policy/discover.js'
import type { PolicyFile } from '../../src/policy/types.js'
import { classifyCase, summarize } from './classify.js'
import { loadCorpus, PRIORITIES, type Priority } from './corpus.js'
import {
  formatCsv,
  formatReadmeBlock,
  formatRunReport,
  parseCsv,
  replaceReadmeBlock,
  toCsvRows,
} from './report.js'

const path = (relative: string) => fileURLToPath(new URL(`../../${relative}`, import.meta.url))

export const POLICY_DIR = path('evals/merge-classification/policy')
export const CORPUS_DIR = path('evals/merge-classification/corpus')
export const CSV_PATH = path('evals/merge-classification/cases.csv')
export const README_PATH = path('evals/README.md')

/** The reference policy is a supervisor policy: it uses `pr/repository` and `pr/labels`. */
export async function loadReferencePolicy(): Promise<PolicyFile[]> {
  return await discoverPolicies(POLICY_DIR, { supervisorPolicy: true })
}

const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: path('.'), encoding: 'utf8' }).trim()

function currentCommit(): string {
  const sha = git('rev-parse', '--short', 'HEAD')
  const measured = ['src/policy', 'scripts', 'evals/merge-classification/policy']
  const dirty = git('status', '--porcelain', '--', ...measured, CORPUS_DIR) !== ''
  return dirty ? `${sha}+dirty` : sha
}

const USAGE = `Usage: pnpm run eval:merge-classification [--priority <${PRIORITIES.join('|')}>]\n`

export async function main(args: string[], stdout: (text: string) => void): Promise<number> {
  let priority: Priority | undefined
  if (args.length > 0) {
    const [flag, value] = args
    if (flag !== '--priority' || args.length !== 2 || !PRIORITIES.includes(value as Priority)) {
      stdout(USAGE)
      return 2
    }
    priority = value as Priority
  }

  const policies = await loadReferencePolicy()
  const corpus = await loadCorpus(CORPUS_DIR)
  const cases = priority ? corpus.filter((c) => c.priority === priority) : corpus
  const results = cases.map((c) => classifyCase(policies, c))
  const summary = summarize(results)
  stdout(formatRunReport(results, summary))

  if (priority) {
    stdout('Filtered run: cases.csv and evals/README.md were not rewritten.\n')
  } else {
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    const run = { date, commit: currentCommit() }
    await writeFile(CSV_PATH, formatCsv(toCsvRows(results, run)))
    const rows = parseCsv(await readFile(CSV_PATH, 'utf8'))
    const readme = await readFile(README_PATH, 'utf8')
    await writeFile(README_PATH, replaceReadmeBlock(readme, formatReadmeBlock(rows)))
  }
  return summary.falseMerges.length > 0 ? 1 : 0
}
