import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const npmVersion = execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim()
const parts = npmVersion.split('.').map(Number)
const [major = 0, minor = 0, patch = 0] = parts
const npmOk = major > 11 || (major === 11 && (minor > 5 || (minor === 5 && patch >= 1)))

if (!npmOk) {
  console.error(`npm >= 11.5.1 is required for OIDC trusted publishing, found ${npmVersion}`)
  process.exit(1)
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }
const expectedTag = `v${pkg.version}`
const releaseTag = process.env.RELEASE_TAG

if (releaseTag !== expectedTag) {
  console.error(`Release tag '${releaseTag ?? ''}' does not match package.json (${expectedTag})`)
  process.exit(1)
}

console.log(`release:check passed (npm ${npmVersion}, tag ${releaseTag})`)
