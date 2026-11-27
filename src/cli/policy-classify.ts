import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { checkAnswer } from '../policy/classifier-answer.js'
import { loadClassifierDef, type ClassifierOutput } from '../policy/classifier-def.js'
import { buildClassifierInput } from '../policy/classifier-input.js'
import { readDiff, readHead } from '../policy/classify-gh.js'
import { findClassifiers } from '../policy/classify-find.js'
import { FactsError, PULL_NUMBER, REPOSITORY } from '../policy/facts-gh.js'
import type { ClassifierResult } from '../policy/types.js'
import { isObject } from '../state/json.js'
import { loadPolicies } from './policy-load.js'
import type { CliIo } from './run.js'

/** What `classify-prepare` wrote for one classifier, or why it wrote nothing. */
type ManifestEntry =
  | {
      name: string
      input: string
      answer: string
      model: string
      outputs: Record<string, ClassifierOutput>
    }
  | { name: string; error: string }

interface Manifest {
  pull: { repository: string; number: number; head: string }
  classifiers: ManifestEntry[]
}

const VALUE_OPTIONS = new Set(['--dir', '--repo-dir', '--out'])

/** The parsed arguments, or the usage error to print. */
function parseArgs(args: string[]) {
  const values = new Map<string, string>()
  const positionals: string[] = []
  let supervisorPolicy = false
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!
    if (VALUE_OPTIONS.has(arg) && i + 1 < args.length) values.set(arg, args[++i]!)
    else if (arg === '--supervisor-policy') supervisorPolicy = true
    else if (!arg.startsWith('-')) positionals.push(arg)
    else return `Unknown or incomplete option: ${arg}`
  }
  const out = values.get('--out')
  if (!out) return '--out is required.'
  return { positionals, supervisorPolicy, out: resolve(out), values }
}

async function prepare(args: Exclude<ReturnType<typeof parseArgs>, string>, io: CliIo) {
  const [repository, number, ...extra] = args.positionals
  if (repository === undefined || number === undefined || extra.length > 0) {
    return 'Expected <owner>/<repo> <pr>.'
  }
  if (!REPOSITORY.test(repository)) return `'${repository}' must look like <owner>/<repo>.`
  if (!PULL_NUMBER.test(number)) return `'${number}' must be a pull request number.`
  const dir = args.values.get('--dir')
  if (!dir) return '--dir is required.'
  const repoDir = args.values.get('--repo-dir')
  const source = { dir, supervisorPolicy: args.supervisorPolicy, ...(repoDir ? { repoDir } : {}) }
  const policies = await loadPolicies(source, io)
  const found = findClassifiers(policies, (p) => (p.supervisorRoot || !repoDir ? dir : repoDir))

  const pr = Number(number)
  const head = await readHead(io.runProcess, repository, pr)
  const diff = found.length > 0 ? await readDiff(io.runProcess, repository, pr) : ''
  if ((await readHead(io.runProcess, repository, pr)) !== head) {
    throw new FactsError(`${repository}#${pr} got a new head while its diff was read`)
  }
  await mkdir(args.out, { recursive: true })
  const classifiers: ManifestEntry[] = []
  for (const { name, classifiers: where, error } of found) {
    let entry: ManifestEntry
    try {
      if (error) throw new Error(error)
      const def = await loadClassifierDef(where, name)
      const input = join(args.out, `${name}.md`)
      const answer = join(args.out, `${name}.answer.json`)
      await writeFile(input, buildClassifierInput(name, def, diff))
      await rm(answer, { force: true })
      entry = { name, input, answer, model: def.model, outputs: def.outputs }
    } catch (err) {
      entry = { name, error: (err as Error).message }
    }
    classifiers.push(entry)
  }
  const manifest: Manifest = { pull: { repository, number: pr, head }, classifiers }
  const text = `${JSON.stringify(manifest, null, 2)}\n`
  await writeFile(join(args.out, 'manifest.json'), text)
  io.stdout(text)
  return 0
}

async function readManifest(out: string): Promise<Manifest> {
  const raw = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8')) as unknown
  if (!isObject(raw) || !isObject(raw.pull) || !Array.isArray(raw.classifiers)) {
    throw new Error('manifest.json is not a classify-prepare manifest')
  }
  return raw as unknown as Manifest
}

async function collect(args: Exclude<ReturnType<typeof parseArgs>, string>, io: CliIo) {
  if (args.positionals.length > 0 || args.values.size > 1 || args.supervisorPolicy) {
    return 'classify-collect takes only --out.'
  }
  const manifest = await readManifest(args.out)
  const { repository, number, head } = manifest.pull
  const current = await readHead(io.runProcess, repository, number)
  if (current !== head) {
    io.stderr(`${repository}#${number} moved from ${head} to ${current}: the results are void.\n`)
    return 1
  }
  const results: Record<string, ClassifierResult> = {}
  for (const entry of manifest.classifiers) {
    const reason = await collectOne(entry, results)
    if (reason) io.stderr(`repo/${entry.name}: no result: ${reason}\n`)
  }
  const path = join(args.out, 'classifiers.json')
  // The head goes in the file, so `policy check` refuses the results for any other head.
  await writeFile(path, `${JSON.stringify({ pull: manifest.pull, ...results }, null, 2)}\n`)
  io.stdout(`${path}\n`)
  return 0
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

export async function runClassify(
  command: 'prepare' | 'collect',
  argv: string[],
  io: CliIo,
  help: string,
): Promise<number> {
  const args = parseArgs(argv)
  try {
    const result =
      typeof args === 'string' ? args : await (command === 'prepare' ? prepare : collect)(args, io)
    if (typeof result === 'number') return result
    io.stderr(`${result}\n${help}`)
    return 2
  } catch (err) {
    io.stderr(`${(err as Error).message}\n`)
    return 2
  }
}
