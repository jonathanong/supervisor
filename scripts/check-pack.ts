import { execFileSync } from 'node:child_process'

const REQUIRED_FILES = [
  'package.json',
  'README.md',
  'LICENSE',
  'dist/cli/index.js',
  'dist/cli/index.d.ts',
  'schemas/config.json',
  'schemas/state.json',
  'agents/supervisor-classifier.md',
  'skills/supervisor-classify/SKILL.md',
  'skills/supervisor-loop/SKILL.md',
  'skills/supervisor-loop/references/config.md',
  'skills/supervisor-pr/SKILL.md',
  'skills/supervisor-sweep/SKILL.md',
  'skills/supervisor-triage-prs/SKILL.md',
  'plugin.json',
  '.mcp.json',
  '.claude-plugin/plugin.json',
  '.claude-plugin/marketplace.json',
  '.codex-plugin/plugin.json',
  '.agents/plugins/marketplace.json',
]

const FORBIDDEN_PATTERNS = [
  /^src\//,
  /^test\//,
  /^docs\//,
  /^evals\//,
  /^examples\//,
  /^scripts\//,
  /^\.github\//,
  /\.map$/,
  /^\.env/,
  /^tsconfig/,
  /^vitest\.config/,
  /^codecov\.yml$/,
]

const raw = execFileSync('pnpm', ['pack', '--dry-run', '--json'], { encoding: 'utf8' })
const parsed = JSON.parse(raw) as { files?: Array<{ path: string }> }
const files = (parsed.files ?? []).map((entry) => entry.path)

if (files.length === 0) {
  console.error('pnpm pack --dry-run reported zero files')
  process.exit(1)
}

const fileSet = new Set(files)
const missing = REQUIRED_FILES.filter((req) => !fileSet.has(req))
const forbidden = files.filter((file) => FORBIDDEN_PATTERNS.some((re) => re.test(file)))

if (missing.length > 0) {
  console.error(`Missing required files in package tarball: ${missing.join(', ')}`)
  process.exit(1)
}
if (forbidden.length > 0) {
  console.error(`Forbidden files in package tarball: ${forbidden.join(', ')}`)
  process.exit(1)
}

console.log(`pack:check passed (${files.length} files verified)`)
