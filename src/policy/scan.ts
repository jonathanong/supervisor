import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { PolicyLoadError } from './types.js'

const IGNORED_DIRS = new Set(['.git', 'node_modules'])

/**
 * The folder that holds a directory's policy file. `.claude` is Claude Approvals' own folder and
 * the one the supervisor policy uses; `.supervisor` holds a repository's policy for the supervisor.
 */
export type PolicyFolder = '.claude' | '.supervisor'

export interface DiscoveredEntry {
  absPath: string
  relPath: string
  dir: string
  size: number
}

/** Finds `<folder>/approvals.yml` (or `.yaml`) in `rootDir` and in every directory below it. */
export async function scanPolicyFiles(
  rootDir: string,
  folder: PolicyFolder,
): Promise<DiscoveredEntry[]> {
  const found: DiscoveredEntry[] = []
  await scanTree(rootDir, '', folder, false, found)
  return found
}

async function scanTree(
  rootDir: string,
  relDir: string,
  folder: PolicyFolder,
  insideFolder: boolean,
  found: DiscoveredEntry[],
): Promise<void> {
  const absDir = relDir ? join(rootDir, relDir) : rootDir
  const entries = await readdir(absDir, { withFileTypes: true })
  entries.sort((a, b) => a.name.localeCompare(b.name))

  const policyDir = entries.find((e) => e.isDirectory() && e.name === folder)
  if (policyDir) {
    const folderRel = relDir ? `${relDir}/${folder}` : folder
    const folderAbs = join(rootDir, folderRel)
    const folderEntries = await readdir(folderAbs, { withFileTypes: true })
    const yml = folderEntries.find((e) => e.isFile() && e.name === 'approvals.yml')
    const yaml = folderEntries.find((e) => e.isFile() && e.name === 'approvals.yaml')

    if (yml && yaml) {
      throw new PolicyLoadError([
        {
          file: `${folderRel}/approvals.yml`,
          path: '$',
          message: 'Directory cannot contain both approvals.yml and approvals.yaml',
        },
      ])
    }
    const target = yml ?? yaml
    if (target) {
      const targetRel = `${folderRel}/${target.name}`
      if (insideFolder) {
        throw new PolicyLoadError([
          {
            file: targetRel,
            path: '$',
            message: `Policy file cannot be inside another ${folder} directory`,
          },
        ])
      }
      const targetAbs = join(folderAbs, target.name)
      const info = await stat(targetAbs)
      found.push({ absPath: targetAbs, relPath: targetRel, dir: relDir, size: info.size })
    }
    await scanTree(rootDir, folderRel, folder, true, found)
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === folder || IGNORED_DIRS.has(entry.name)) continue
    const childRel = relDir ? `${relDir}/${entry.name}` : entry.name
    await scanTree(rootDir, childRel, folder, insideFolder, found)
  }
}
