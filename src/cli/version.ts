import { readFileSync } from 'node:fs'

const packageJsonUrl = new URL('../../package.json', import.meta.url)

/** Minimum `@jongleberry/supervisor` CLI version required by the bundled skills. */
export const MIN_CLI_VERSION = '0.4.0'

export const INSTALL_COMMAND = 'pnpm add -g @jongleberry/supervisor'

export interface Semver {
  major: number
  minor: number
  patch: number
  prerelease: string | undefined
}

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

export function parseVersion(raw: string): Semver | undefined {
  const match = SEMVER_RE.exec(raw.trim())
  if (match === null) {
    return undefined
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4],
  }
}

function comparePrerelease(a: string, b: string): number {
  const aParts = a.split('.')
  const bParts = b.split('.')
  const len = Math.min(aParts.length, bParts.length)
  for (let i = 0; i < len; i += 1) {
    const ap = aParts[i]!
    const bp = bParts[i]!
    if (ap === bp) {
      continue
    }
    const aNum = /^\d+$/.test(ap)
    const bNum = /^\d+$/.test(bp)
    if (aNum && bNum) {
      return Number(ap) - Number(bp)
    }
    if (aNum !== bNum) {
      return aNum ? -1 : 1
    }
    return ap < bp ? -1 : 1
  }
  return aParts.length - bParts.length
}

/** Compare two parsed semver versions (<0 if a < b, 0 if equal, >0 if a > b). */
export function compareVersion(a: Semver, b: Semver): number {
  if (a.major !== b.major) {
    return a.major - b.major
  }
  if (a.minor !== b.minor) {
    return a.minor - b.minor
  }
  if (a.patch !== b.patch) {
    return a.patch - b.patch
  }
  if (a.prerelease === b.prerelease) {
    return 0
  }
  if (a.prerelease === undefined) {
    return 1
  }
  if (b.prerelease === undefined) {
    return -1
  }
  return comparePrerelease(a.prerelease, b.prerelease)
}

export function getVersion(): string {
  const raw = readFileSync(packageJsonUrl, 'utf8')
  const parsed = JSON.parse(raw) as { version: string }
  return parsed.version
}
