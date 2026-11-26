import { createPrShepherd } from 'pr-shepherd'
import type { ShepherdStatus } from '../policy/facts-readiness.js'

/**
 * pr-shepherd's read-only `status`: one tick that makes no GitHub mutation and writes no local
 * state. It reads `.pr-shepherdrc.yml` from `cwd` and merges nothing, whatever it answers.
 */
export const shepherdStatus: ShepherdStatus = async (pull, cwd) => {
  const result = await createPrShepherd({ cwd }).status({
    pr: pull,
    merge: true,
    readyDelaySeconds: 0,
  })
  return {
    action: result.action,
    ...(result.headSha === undefined ? {} : { headSha: result.headSha }),
    ...('log' in result ? { log: result.log } : {}),
  }
}
