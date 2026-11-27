import { homedir } from 'node:os'
import { join } from 'node:path'
import type { LoopConfig, SupervisorConfig } from './types.js'

/** How many scheduled-prompt runs state keeps when `scheduledPrompts.history` is not set. */
export const DEFAULT_PROMPT_HISTORY = 20

/** A leading `~/` (or a bare `~`) means the home directory. */
export function expandHome(value: string): string {
  if (value === '~') {
    return homedir()
  }
  return value.startsWith('~/') ? join(homedir(), value.slice(2)) : value
}

/** Expand `~/` in the path values and fill in every documented default. */
export function applyDefaults(raw: SupervisorConfig): LoopConfig {
  const { scheduledPrompts, staleRuns, stateDir, ...rest } = raw
  return {
    ...rest,
    scopes: raw.scopes.map((scope) =>
      scope.checkoutRoot === undefined
        ? scope
        : { ...scope, checkoutRoot: expandHome(scope.checkoutRoot) },
    ),
    ...(stateDir === undefined ? {} : { stateDir: expandHome(stateDir) }),
    fallbackCron: raw.fallbackCron ?? '0 */6 * * *',
    lateReviewDays: raw.lateReviewDays ?? 14,
    fullRescanDays: raw.fullRescanDays ?? 7,
    layerCap: raw.layerCap ?? 10,
    ...(scheduledPrompts === undefined
      ? {}
      : {
          scheduledPrompts: { quota: 1, history: DEFAULT_PROMPT_HISTORY, ...scheduledPrompts },
        }),
    staleRuns: staleRuns === false ? false : { olderThan: '6h', cancelAfter: '24h', ...staleRuns },
    eventWait: {
      hookHarness: '0.4.1',
      timeout: '2h',
      advance: false,
      updateCheckDelay: '10m',
      ...raw.eventWait,
    },
  }
}
