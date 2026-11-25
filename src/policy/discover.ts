import { readdir, stat } from 'node:fs/promises'
import { join, posix } from 'node:path'
import { matchesRulePaths, toRelativePath } from './glob.js'
import { loadPolicyFile } from './load.js'
import { POLICY_LIMITS, PolicyLoadError, type PolicyFile, type PolicyRule } from './types.js'

const IGNORED_DIRS = new Set(['.git', 'node_modules'])

interface DiscoveredEntry {
  absPath: string
  relPath: string
  dir: string
  size: number
}

async function scanTree(
  rootDir: string,
  relDir: string,
  insideClaudeDir: boolean,
  found: DiscoveredEntry[],
): Promise<void> {
  const absDir = relDir ? join(rootDir, relDir) : rootDir
  const entries = await readdir(absDir, { withFileTypes: true })
  entries.sort((a, b) => a.name.localeCompare(b.name))

  const claudeDir = entries.find((e) => e.isDirectory() && e.name === '.claude')
  if (claudeDir) {
    const claudeRel = relDir ? `${relDir}/.claude` : '.claude'
    const claudeAbs = join(rootDir, claudeRel)
    const claudeEntries = await readdir(claudeAbs, { withFileTypes: true })
    const yml = claudeEntries.find((e) => e.isFile() && e.name === 'approvals.yml')
    const yaml = claudeEntries.find((e) => e.isFile() && e.name === 'approvals.yaml')

    if (yml && yaml) {
      throw new PolicyLoadError([
        {
          file: `${claudeRel}/approvals.yml`,
          path: '$',
          message: 'Directory cannot contain both approvals.yml and approvals.yaml',
        },
      ])
    }
    const target = yml ?? yaml
    if (target) {
      const targetRel = `${claudeRel}/${target.name}`
      if (insideClaudeDir) {
        throw new PolicyLoadError([
          {
            file: targetRel,
            path: '$',
            message: 'Policy file cannot be inside another .claude directory',
          },
        ])
      }
      const targetAbs = join(claudeAbs, target.name)
      const info = await stat(targetAbs)
      found.push({ absPath: targetAbs, relPath: targetRel, dir: relDir, size: info.size })
    }
    await scanTree(rootDir, claudeRel, true, found)
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === '.claude' || IGNORED_DIRS.has(entry.name)) continue
    await scanTree(rootDir, relDir ? `${relDir}/${entry.name}` : entry.name, insideClaudeDir, found)
  }
}

export interface DiscoverPoliciesOptions {
  supervisorPolicy?: boolean
}

export async function discoverPolicies(
  rootDir: string,
  opts: DiscoverPoliciesOptions = {},
): Promise<PolicyFile[]> {
  const entries: DiscoveredEntry[] = []
  await scanTree(rootDir, '', false, entries)

  if (entries.length > POLICY_LIMITS.maxRepoPolicyFiles) {
    throw new PolicyLoadError([
      {
        file: rootDir,
        path: '$',
        message: `Repository exceeds maximum of ${POLICY_LIMITS.maxRepoPolicyFiles} policy files`,
      },
    ])
  }
  const totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0)
  if (totalBytes > POLICY_LIMITS.maxRepoTotalBytes) {
    throw new PolicyLoadError([
      {
        file: rootDir,
        path: '$',
        message: `Policy files exceed maximum total size of ${POLICY_LIMITS.maxRepoTotalBytes} bytes`,
      },
    ])
  }

  const depth = (dir: string) => (dir === '' ? 0 : dir.split('/').length)
  entries.sort((a, b) => depth(a.dir) - depth(b.dir) || a.relPath.localeCompare(b.relPath))

  const loadedByDir = new Map<string, PolicyFile>()
  const loaded: PolicyFile[] = []
  for (const entry of entries) {
    const inheritedLocals: Record<string, unknown> = {}
    for (const ancestorDir of ancestorDirs(entry.dir)) {
      const ancestor = loadedByDir.get(ancestorDir)
      if (ancestor) Object.assign(inheritedLocals, ancestor.locals)
    }
    const policy = await loadPolicyFile(entry.absPath, {
      filePath: entry.relPath,
      dir: entry.dir,
      inheritedLocals,
      ...(opts.supervisorPolicy !== undefined ? { supervisorPolicy: opts.supervisorPolicy } : {}),
    })
    loadedByDir.set(entry.dir, policy)
    loaded.push(policy)
  }
  return loaded
}

function ancestorDirs(dir: string): string[] {
  if (dir === '') return []
  const parts = dir.split('/')
  const result = ['']
  for (let i = 1; i < parts.length; i += 1) result.push(parts.slice(0, i).join('/'))
  return result
}

function fileDirChain(filePath: string): string[] {
  const normalized = filePath.replace(/^\/+|\/+$/g, '')
  const dir = posix.dirname(normalized)
  if (dir === '.' || dir === '') return ['']
  const parts = dir.split('/')
  const chain: string[] = []
  for (let i = parts.length; i >= 1; i -= 1) chain.push(parts.slice(0, i).join('/'))
  chain.push('')
  return chain
}

export interface SelectedFileRules {
  decidingPolicy: PolicyFile | null
  rules: PolicyRule[]
}

export function selectRulesForFile(policies: PolicyFile[], filePath: string): SelectedFileRules {
  const byDir = new Map(policies.map((p) => [p.dir, p]))
  const chain = fileDirChain(filePath)

  let decidingIndex = -1
  for (let i = 0; i < chain.length; i += 1) {
    const policy = byDir.get(chain[i]!)
    if (!policy || policy.effectiveObserve) continue
    const rel = toRelativePath(filePath, policy.dir)!
    const matchesVerdictRule = policy.rules.some(
      (rule) =>
        rule.mode === 'enforce' && rule.verdict !== undefined && matchesRulePaths(rel, rule.paths),
    )
    if (matchesVerdictRule) {
      decidingIndex = i
      break
    }
  }
  if (decidingIndex === -1) return { decidingPolicy: null, rules: [] }

  const decidingPolicy = byDir.get(chain[decidingIndex]!)!
  const selected: PolicyRule[] = []
  const decidingRel = toRelativePath(filePath, decidingPolicy.dir)!
  for (const rule of decidingPolicy.rules) {
    if (rule.mode === 'enforce' && matchesRulePaths(decidingRel, rule.paths)) selected.push(rule)
  }
  for (let i = decidingIndex + 1; i < chain.length; i += 1) {
    const ancestor = byDir.get(chain[i]!)
    if (!ancestor || ancestor.effectiveObserve) continue
    const rel = toRelativePath(filePath, ancestor.dir)!
    for (const rule of ancestor.rules) {
      if (
        rule.mode === 'enforce' &&
        rule.nested === 'inherit' &&
        matchesRulePaths(rel, rule.paths)
      ) {
        selected.push(rule)
      }
    }
  }
  return { decidingPolicy, rules: selected }
}
