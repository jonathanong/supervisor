import { cp, mkdtemp, readdir, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll } from 'vitest'

/** The name a repository fixture gives its `.supervisor` folder on disk. */
export const STORED_FOLDER = 'dot-supervisor'

const dirs: string[] = []
afterAll(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function restoreFolders(dir: string): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (entry.name === STORED_FOLDER) await rename(join(dir, entry.name), join(dir, '.supervisor'))
    else await restoreFolders(join(dir, entry.name))
  }
}

/**
 * A copy of a repository fixture, in a temporary directory, with its policy folders under their
 * real name. The fixtures store `.supervisor` as `dot-supervisor`, so that a checkout of this
 * repository holds no repository policy of its own under `test/`: a real `.supervisor` folder
 * there would be read as this repository's policy for the fixture's paths.
 */
export async function repoFixture(name: string): Promise<string> {
  const source = fileURLToPath(new URL(`../fixtures/policies/${name}`, import.meta.url))
  const dir = await mkdtemp(join(tmpdir(), 'supervisor-repo-fixture-'))
  dirs.push(dir)
  await cp(source, dir, { recursive: true })
  await restoreFolders(dir)
  return dir
}
