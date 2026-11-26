import { matchesRulePaths } from './glob.js'
import type { Verdict } from './types.js'

/**
 * Files that decide what may merge: policy files, for Claude Approvals and for the supervisor, and
 * classifier definitions, at any depth.
 */
export const PROTECTED_PATHS: readonly string[] = [
  '**/.supervisor/approvals.yml',
  '**/.supervisor/approvals.yaml',
  '**/.claude/approvals.yml',
  '**/.claude/approvals.yaml',
  '**/.claude/classifiers/**',
]

export function isProtectedPath(filePath: string): boolean {
  return matchesRulePaths(filePath.replace(/^\/+|\/+$/g, ''), [...PROTECTED_PATHS])
}

/**
 * What a changed protected file takes where no rule applies to it: one person other than the
 * author, no bot, and no merge by the supervisor.
 */
export const PROTECTED_BASELINE: Verdict = {
  claude: 'comments',
  seats: [{ count: 1, from: ['humans', '!pr/authors', '!pr/opened_by'] }],
}
