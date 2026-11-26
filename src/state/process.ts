import { spawn } from 'node:child_process'

export interface ProcessResult {
  code: number
  stdout: string
  stderr: string
}

/** Runs one external command from an argument array; never through a shell. */
export type RunProcess = (command: string, args: string[]) => Promise<ProcessResult>

export const runProcess: RunProcess = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
