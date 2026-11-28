import { ConfigError, loadConfig } from './load.js'
import type { Scope } from './types.js'

/** Core claim fields always present in every provenance comment, in fixed order. */
export const CORE_PROVENANCE_FIELDS = ['harness', 'version', 'models', 'session', 'role'] as const

const CORE_FIELD_SET = new Set<string>(CORE_PROVENANCE_FIELDS)
const VALID_FIELD_NAME = /^[a-zA-Z0-9_-]+$/

export interface ResolvedProvenanceConfig {
  extraFields: string[]
  allFields: string[]
}

function findMatchingScope(scopes: readonly Scope[], repository: string): Scope | undefined {
  const [owner, repo] = repository.split('/') as [string, string]
  const lowerOwner = owner.toLowerCase()
  const lowerRepo = repo.toLowerCase()
  const matchesRepo = (name: string) => name.toLowerCase() === lowerRepo
  return scopes.find(
    (entry) =>
      entry.owner.toLowerCase() === lowerOwner &&
      (entry.repos === '*' || entry.repos.some(matchesRepo)) &&
      !(entry.excludedRepos ?? []).some(matchesRepo),
  )
}

/**
 * Resolves the provenance fields configured for `repository` from the supervisor configuration
 * (`$SUPERVISOR_CONFIG`, else `.supervisor.json` in `cwd`). Scope `provenance.fields` overrides
 * top-level `provenance.fields`. Core fields are always required; remaining unique configured
 * fields are required extra fields in configured order.
 */
export async function resolveProvenanceFields(
  env: Record<string, string | undefined>,
  cwd: string,
  repository: string,
): Promise<ResolvedProvenanceConfig> {
  const { path, config } = await loadConfig(env, cwd)
  const scope = findMatchingScope(config.scopes, repository)
  const configured = scope?.provenance?.fields ?? config.provenance.fields
  const extraFields: string[] = []
  const seen = new Set<string>(CORE_FIELD_SET)

  for (const field of configured) {
    if (!VALID_FIELD_NAME.test(field)) {
      throw new ConfigError(
        `supervisor config ${path}: provenance field '${field}' must match ${VALID_FIELD_NAME.source}`,
      )
    }
    if (!seen.has(field)) {
      seen.add(field)
      extraFields.push(field)
    }
  }

  return {
    extraFields,
    allFields: [...CORE_PROVENANCE_FIELDS, ...extraFields],
  }
}
