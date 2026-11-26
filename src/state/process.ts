import { spawn } from 'node:child_process'

export interface ProcessResult {
  code: number
  stdout: string
  stderr: string
}

export interface ProcessOptions {
  cwd?: string
  /** Pass the child's stderr through instead of capturing it. */
  inheritStderr?: boolean
  /** Kill the child after this long; it then resolves with a non-zero code. */
  timeoutMs?: number
}

/** Runs one external command from an argument array; never through a shell. */
export type RunProcess = (
  command: string,
  args: string[],
  options?: ProcessOptions,
) => Promise<ProcessResult>

export const runProcess: RunProcess = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      timeout: options.timeoutMs,
      stdio: ['ignore', 'pipe', options.inheritStderr ? 'inherit' : 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout!.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
