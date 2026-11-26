import type { CaseResult, Summary, Tally } from './classify.js'

/** Every case's target: one deterministic attempt either passes or does not. */
const TARGET = 'pass'

const CSV_COLUMNS = [
  'case',
  'group',
  'priority',
  'target',
  'label',
  'actual',
  'verdict',
  'run_date',
  'commit',
] as const

export type CsvRow = Record<(typeof CSV_COLUMNS)[number], string>

export interface RunInfo {
  date: string
  commit: string
}

export function toCsvRows(results: CaseResult[], run: RunInfo): CsvRow[] {
  return results.map((result) => ({
    case: result.case.id,
    group: result.case.group,
    priority: result.case.priority,
    target: TARGET,
    label: result.case.label,
    actual: result.actual,
    verdict: result.outcome === 'correct' ? 'met' : 'missed',
    run_date: run.date,
    commit: run.commit,
  }))
}

export function formatCsv(rows: CsvRow[]): string {
  const lines = [CSV_COLUMNS.join(',')]
  for (const row of rows) lines.push(CSV_COLUMNS.map((column) => row[column]).join(','))
  return `${lines.join('\n')}\n`
}

export function parseCsv(source: string): CsvRow[] {
  const [header, ...lines] = source.trimEnd().split('\n')
  if (header !== CSV_COLUMNS.join(',')) throw new Error('cases.csv has an unexpected header')
  return lines.map((line) => {
    const cells = line.split(',')
    if (cells.length !== CSV_COLUMNS.length) throw new Error(`Malformed cases.csv row: ${line}`)
    return Object.fromEntries(CSV_COLUMNS.map((column, i) => [column, cells[i]])) as CsvRow
  })
}

function pad(rows: string[][]): string[][] {
  const widths = rows[0]!.map((_, col) => Math.max(...rows.map((row) => row[col]!.length)))
  return rows.map((row) => row.map((cell, col) => cell.padEnd(widths[col]!)))
}

export function formatTextTable(rows: string[][]): string {
  return pad(rows)
    .map((row) => row.join('  ').trimEnd())
    .join('\n')
}

function formatMarkdownTable(rows: string[][]): string {
  const [header, ...body] = pad(rows.map((row) => row.map((cell) => cell.padEnd(3))))
  const separator = header!.map((cell) => '-'.repeat(cell.length))
  return [header!, separator, ...body].map((row) => `| ${row.join(' | ')} |`).join('\n')
}

const ids = (list: string[]): string => (list.length > 0 ? ` (${list.join(', ')})` : '')

function tallyLine(name: string, tally: Tally): string {
  return `${name}: ${tally.met} of ${tally.cases} met; false merges ${tally.falseMerges.length}${ids(tally.falseMerges)}; missed merges ${tally.missedMerges.length}${ids(tally.missedMerges)}`
}

export function formatRunReport(results: CaseResult[], summary: Summary): string {
  const table = formatTextTable([
    ['case', 'group', 'priority', 'label', 'actual', 'policy verdict', 'next step', 'result'],
    ...results.map((r) => [
      r.case.id,
      r.case.group,
      r.case.priority,
      r.case.label,
      r.actual,
      r.policyVerdict,
      r.nextStep,
      r.outcome === 'correct' ? 'correct' : r.outcome.replace('-', ' ').toUpperCase(),
    ]),
  ])
  const lines = [
    table,
    '',
    `Cases: ${summary.cases}`,
    `Correct: ${summary.met}`,
    `False merges: ${summary.falseMerges.length}${ids(summary.falseMerges)}`,
    `Missed merges: ${summary.missedMerges.length}${ids(summary.missedMerges)}`,
    tallyLine("Label 'person'", summary.byLabel.person),
    tallyLine("Label 'merge'", summary.byLabel.merge),
    ...Object.entries(summary.byPriority).map(([p, tally]) => tallyLine(`Priority ${p}`, tally)),
    `Gate (zero false merges): ${summary.falseMerges.length === 0 ? 'PASS' : 'FAIL'}`,
  ]
  return `${lines.join('\n')}\n`
}

const isFalseMerge = (row: CsvRow) => row.label === 'person' && row.actual === 'merge'
const isMissedMerge = (row: CsvRow) => row.label === 'merge' && row.actual === 'person'

function breakdown(rows: CsvRow[], key: 'group' | 'label', first: string, extra: string): string {
  const names = [...new Set(rows.map((row) => row[key]))]
  const body = names.map((name) => {
    const own = rows.filter((row) => row[key] === name)
    const column = key === 'label' ? [...new Set(own.map((row) => row.priority))].join(', ') : ''
    return [
      name,
      ...(extra ? [column] : []),
      String(own.length),
      String(own.filter((row) => row.verdict === 'met').length),
      String(own.filter(isFalseMerge).length),
      String(own.filter(isMissedMerge).length),
    ]
  })
  const header = [first, ...(extra ? [extra] : []), 'Cases', 'Met', 'False merges', 'Missed merges']
  return formatMarkdownTable([header, ...body])
}

/** The results section of `evals/README.md`, built only from the tracking CSV. */
export function formatReadmeBlock(rows: CsvRow[]): string {
  const falseMerges = rows.filter(isFalseMerge).map((row) => row.case)
  const missedMerges = rows.filter(isMissedMerge).map((row) => row.case)
  const runs = [...new Set(rows.map((row) => `${row.run_date} at commit \`${row.commit}\``))]
  return [
    `Run: ${runs.join('; ')}. One deterministic attempt per case: no model, no judge, no arms, cost $0.`,
    '',
    `Gate (zero false merges): **${falseMerges.length === 0 ? 'pass' : 'FAIL'}**. False merges: ${falseMerges.length}${ids(falseMerges)}. Missed merges: ${missedMerges.length}${ids(missedMerges)}.`,
    '',
    breakdown(rows, 'label', 'Label', 'Priority'),
    '',
    breakdown(rows, 'group', 'Group', ''),
  ].join('\n')
}

export const README_START = '<!-- merge-classification:results:start (generated from cases.csv) -->'
export const README_END = '<!-- merge-classification:results:end -->'

export function replaceReadmeBlock(readme: string, block: string): string {
  const start = readme.indexOf(README_START)
  const end = readme.indexOf(README_END)
  if (start === -1 || end === -1 || end < start) {
    throw new Error('README is missing the merge-classification result markers')
  }
  return `${readme.slice(0, start)}${README_START}\n\n${block}\n\n${readme.slice(end)}`
}
