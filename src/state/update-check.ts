import { NAME } from './context.js'
import { StateError } from './store.js'
import { UPDATE_CHECK_BODY } from './update-check-body.js'

/**
 * The `TARGETS` literal. `name` checks every ecosystem; `name:npm,pip` limits the check to those.
 * Repeated targets for one repository combine, and an unrestricted one covers every ecosystem.
 */
function targets(repos: string[]): string {
  const merged = new Map<string, string[] | null>()
  for (const repo of repos) {
    const colon = repo.indexOf(':')
    const name = colon === -1 ? repo : repo.slice(0, colon)
    const ecosystems = colon === -1 ? '' : repo.slice(colon + 1)
    const listed = ecosystems ? ecosystems.split(',') : []
    if (!NAME.test(name) || !listed.every((ecosystem) => NAME.test(ecosystem))) {
      throw new StateError(
        `update-check-script: '${repo}' must be name or name:ecosystem[,ecosystem]`,
      )
    }
    const have = merged.get(name) ?? []
    const every = listed.length === 0 || merged.get(name) === null
    merged.set(name, every ? null : [...have, ...listed.filter((item) => !have.includes(item))])
  }
  const entries = [...merged].map(([name, listed]) => {
    const value = listed ? `[${listed.map((item) => `'${item}'`).join(', ')}]` : 'null'
    return `'${name}': ${value}`
  })
  return `{ ${entries.join(', ')} }`
}

/** The update-check script for one owner's repositories, ready for a browser's script tool. */
export function updateCheckScript(owner: string, repos: string[], dry: boolean): string {
  if (!NAME.test(owner)) {
    throw new StateError(`update-check-script: owner '${owner}' is not a valid owner name`)
  }
  const head = [`const ORG = '${owner}'`, `const TARGETS = ${targets(repos)}`, `const DRY = ${dry}`]
  return `${head.join('\n')}\n${UPDATE_CHECK_BODY}`
}
