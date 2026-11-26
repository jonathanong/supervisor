import { matchesRulePaths } from './glob.js'
import type { Verdict } from './types.js'

/**
 * Files that decide what may merge or what a review sees, as Claude Approvals protects them: policy
 * files (the product's and the supervisor's), classifier definitions, `.gitattributes` and
 * `.gitmodules`, at any depth, and the root `REVIEW.md`. The product also protects symlinks and
 * submodules, which a path cannot tell; the supervisor does not.
 */
export const PROTECTED_PATHS: readonly string[] = [
  '**/.supervisor/approvals.yml',
  '**/.supervisor/approvals.yaml',
  '**/.claude/approvals.yml',
  '**/.claude/approvals.yaml',
  '**/.claude/classifiers/**',
  '**/.gitattributes',
  '**/.gitmodules',
  'REVIEW.md',
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
