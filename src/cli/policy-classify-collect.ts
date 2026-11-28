import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { checkAnswer } from '../policy/classifier-answer.js'
import { readHead, readReviews } from '../policy/classify-gh.js'
import { mapFinalReview } from '../policy/code-review.js'
import type { ClassifierResult } from '../policy/types.js'
import { isObject } from '../state/json.js'
import type { ClassifyArgs, Manifest, ManifestEntry } from './policy-classify.js'
import { reviewerFromConfig } from '../config/policy.js'
import type { CliIo } from './run.js'

async function readManifest(out: string): Promise<Manifest> {
  const raw = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8')) as unknown
  if (!isObject(raw) || !isObject(raw.pull) || !Array.isArray(raw.classifiers)) {
    throw new Error('manifest.json is not a classify-prepare manifest')
  }
  return raw as unknown as Manifest
}

async function headMoved(pull: Manifest['pull'], io: CliIo): Promise<boolean> {
  const current = await readHead(io.runProcess, pull.repository, pull.number)
  if (current === pull.head) return false
  io.stderr(
    `${pull.repository}#${pull.number} moved from ${pull.head} to ${current}: the results are void.\n`,
  )
  return true
}

/** Adds the entry's result, or returns why it has none. */
async function collectOne(
  entry: ManifestEntry,
  results: Record<string, ClassifierResult>,
): Promise<string | undefined> {
  if ('error' in entry) return entry.error
  let text: string
  try {
    text = await readFile(entry.answer, 'utf8')
  } catch {
    return 'there is no answer file'
  }
  const result = checkAnswer(entry.outputs, text)
  if (typeof result === 'string') return result
  results[`repo/${entry.name}`] = result
  return undefined
}

async function collectCodeReview(
  pull: Manifest['pull'],
  reviewerArg: string | undefined,
  io: CliIo,
  results: Record<string, ClassifierResult>,
): Promise<boolean> {
  const reviewer = reviewerArg ?? (await reviewerFromConfig(io.env, process.cwd()))
  if (!reviewer) {
    io.stderr(
      'claude/code_review: no result: no trusted reviewer configured ' +
        '(pass --reviewer or set finalReview.reviewer)\n',
    )
    return true
  }
  const reviews = await readReviews(io.runProcess, pull.repository, pull.number)
  if (await headMoved(pull, io)) return false
  const mapped = mapFinalReview(reviews, pull.head, reviewer)
  if (typeof mapped === 'string') io.stderr(`claude/code_review: no result: ${mapped}\n`)
  else results['claude/code_review'] = mapped
  return true
}

export async function collectClassifiers(args: ClassifyArgs, io: CliIo): Promise<number | string> {
  const extra = [...args.values.keys()].find((key) => key !== '--out' && key !== '--reviewer')
  if (args.positionals.length > 0 || extra !== undefined || args.supervisorPolicy) {
    return 'classify-collect takes only --out and --reviewer.'
  }
  const manifest = await readManifest(args.out)
  if (await headMoved(manifest.pull, io)) return 1
  const results: Record<string, ClassifierResult> = {}
  for (const entry of manifest.classifiers) {
    const reason = await collectOne(entry, results)
    if (reason) io.stderr(`repo/${entry.name}: no result: ${reason}\n`)
  }
  const reviewer = args.values.get('--reviewer')
  if (
    manifest.codeReview === true &&
    !(await collectCodeReview(manifest.pull, reviewer, io, results))
  ) {
    return 1
  }
  const path = join(args.out, 'classifiers.json')
  // The head goes in the file, so `policy check` refuses the results for any other head.
  await writeFile(path, `${JSON.stringify({ pull: manifest.pull, ...results }, null, 2)}\n`)
  io.stdout(`${path}\n`)
  return 0
}
