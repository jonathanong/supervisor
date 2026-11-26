import { posix } from 'node:path'
import { matchesRulePaths, toRelativePath } from './glob.js'
import { loadPolicyFile } from './load.js'
import { scanPolicyFiles, type PolicyFolder } from './scan.js'
import { POLICY_LIMITS, PolicyLoadError, type PolicyFile, type PolicyRule } from './types.js'

export interface DiscoverPoliciesOptions {
  /** Accept the supervisor-only facts `pr/repository` and `pr/labels`. */
  supervisorPolicy?: boolean
  /** The folder that holds each policy file. Defaults to `.claude`. */
  folder?: PolicyFolder
  /** Locals of a policy file above `rootDir`, which every file found here inherits. */
  inheritedLocals?: Record<string, unknown>
}

export async function discoverPolicies(
  rootDir: string,
  opts: DiscoverPoliciesOptions = {},
): Promise<PolicyFile[]> {
  const entries = await scanPolicyFiles(rootDir, opts.folder ?? '.claude')

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
    const inheritedLocals: Record<string, unknown> = { ...opts.inheritedLocals }
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

/**
 * Picks the rules that decide for one file. Going up from the file's directory, the first enforcing
 * policy file with a matching verdict rule decides; above it only `nested: inherit` rules count.
 * A policy marked `supervisorRoot` sits above every other file, a repository's root file included.
 */
export function selectRulesForFile(policies: PolicyFile[], filePath: string): SelectedFileRules {
  const byDir = new Map(policies.filter((p) => !p.supervisorRoot).map((p) => [p.dir, p]))
  const chain = fileDirChain(filePath).flatMap((dir) => byDir.get(dir) ?? [])
  chain.push(...policies.filter((p) => p.supervisorRoot))
  const enforcing = chain.filter((policy) => !policy.effectiveObserve)
  const matching = (policy: PolicyFile) => {
    const rel = toRelativePath(filePath, policy.dir)!
    return policy.rules.filter((r) => r.mode === 'enforce' && matchesRulePaths(rel, r.paths))
  }

  const decidingIndex = enforcing.findIndex((policy) =>
    matching(policy).some((rule) => rule.verdict !== undefined),
  )
  if (decidingIndex === -1) return { decidingPolicy: null, rules: [] }

  const selected = matching(enforcing[decidingIndex]!)
  for (const ancestor of enforcing.slice(decidingIndex + 1)) {
    selected.push(...matching(ancestor).filter((rule) => rule.nested === 'inherit'))
  }
  return { decidingPolicy: enforcing[decidingIndex]!, rules: selected }
}
