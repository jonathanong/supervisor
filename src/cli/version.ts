import { readFileSync } from 'node:fs'

const packageJsonUrl = new URL('../../package.json', import.meta.url)

export function getVersion(): string {
  const raw = readFileSync(packageJsonUrl, 'utf8')
  const parsed = JSON.parse(raw) as { version: string }
  return parsed.version
}
