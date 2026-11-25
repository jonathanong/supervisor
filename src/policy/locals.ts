import { POLICY_LIMITS, type PolicyValidationError } from './types.js'

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function resolveLocalValue(
  raw: unknown,
  locals: Record<string, unknown>,
  path: string,
  file: string,
  errors: PolicyValidationError[],
): unknown {
  if (typeof raw !== 'string' || !/^@[A-Za-z0-9_-]+$/.test(raw)) return raw
  const name = raw.slice(1)
  if (!(name in locals)) {
    errors.push({ file, path, message: `Unknown local '${raw}'` })
    return undefined
  }
  return locals[name]
}

export function expandUseMaps(
  raw: Record<string, unknown>,
  locals: Record<string, unknown>,
  allowedMapKeys: Set<string>,
  path: string,
  file: string,
  errors: PolicyValidationError[],
): Record<string, unknown> {
  if (raw.use === undefined) return raw
  if (!Array.isArray(raw.use)) {
    errors.push({ file, path: `${path}.use`, message: 'use must be a list of @name references' })
    return raw
  }
  if (raw.use.length > POLICY_LIMITS.maxUseNames) {
    errors.push({
      file,
      path: `${path}.use`,
      message: `use exceeds maximum of ${POLICY_LIMITS.maxUseNames} names`,
    })
    return raw
  }
  const merged: Record<string, unknown> = {}
  for (let i = 0; i < raw.use.length; i += 1) {
    const entry = raw.use[i]
    const ep = `${path}.use[${i}]`
    if (typeof entry !== 'string' || !entry.startsWith('@')) {
      errors.push({ file, path: ep, message: 'use entry must be an @name string' })
      continue
    }
    const target = resolveLocalValue(entry, locals, ep, file, errors)
    if (target === undefined) continue
    if (!isPlainObject(target)) {
      errors.push({ file, path: ep, message: `Local '${entry}' must hold a map for use` })
      continue
    }
    for (const [k, v] of Object.entries(target)) {
      if (!allowedMapKeys.has(k)) {
        errors.push({
          file,
          path: `${ep}.${k}`,
          message: `Key '${k}' is not allowed inside a local used at ${path}`,
        })
      } else {
        merged[k] = v
      }
    }
  }
  for (const [k, v] of Object.entries(raw)) {
    if (k !== 'use') merged[k] = v
  }
  return merged
}

export function expandStringListWithLocals(
  raw: unknown,
  locals: Record<string, unknown>,
  path: string,
  file: string,
  errors: PolicyValidationError[],
  preserveEscapes = false,
): string[] {
  const expanded: unknown[] = []
  const resolvedTop = resolveLocalValue(raw, locals, path, file, errors)
  const sourceList = Array.isArray(resolvedTop) ? resolvedTop : [resolvedTop]
  for (let i = 0; i < sourceList.length; i += 1) {
    const item = sourceList[i]
    const ip = `${path}[${i}]`
    if (typeof item !== 'string') {
      errors.push({ file, path: ip, message: 'Expected string entry' })
      continue
    }
    if (item.startsWith('!@')) {
      const val = resolveLocalValue(item.slice(1), locals, ip, file, errors)
      if (val === undefined) continue
      const list = Array.isArray(val) ? val : [val]
      for (const sub of list) {
        if (typeof sub !== 'string') {
          errors.push({ file, path: ip, message: `Local '${item.slice(1)}' must hold strings` })
          break
        }
        expanded.push(`!${sub}`)
      }
    } else if (item.startsWith('@')) {
      const val = resolveLocalValue(item, locals, ip, file, errors)
      if (val === undefined) continue
      if (Array.isArray(val)) expanded.push(...val)
      else expanded.push(val)
    } else if (!preserveEscapes && item.startsWith('\\@')) {
      expanded.push(item.slice(1))
    } else {
      expanded.push(item)
    }
  }
  const result: string[] = []
  for (let i = 0; i < expanded.length; i += 1) {
    if (typeof expanded[i] !== 'string') {
      errors.push({ file, path: `${path}[${i}]`, message: 'Expanded list entry must be a string' })
    } else {
      result.push(expanded[i] as string)
    }
  }
  return result
}

function serializeLocal(value: unknown): string | null {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  if (Array.isArray(value) && value.every((v) => typeof v === 'string' || typeof v === 'number')) {
    return `[${value.map(String).join(', ')}]`
  }
  return null
}

export function expandConditionLocals(
  source: string,
  locals: Record<string, unknown>,
  path: string,
  file: string,
  errors: PolicyValidationError[],
): string {
  let out = ''
  let i = 0
  let inSingle = false
  while (i < source.length) {
    const ch = source[i]!
    if (ch === "'" && (i === 0 || source[i - 1] !== '\\')) {
      inSingle = !inSingle
      out += ch
      i += 1
      continue
    }
    if (!inSingle && ch === '\\' && source[i + 1] === '@') {
      out += '@'
      i += 2
      continue
    }
    if (!inSingle && ch === '@' && (i === 0 || !/[A-Za-z0-9_-]/.test(source[i - 1]!))) {
      const match = /^@([A-Za-z0-9_-]+)/.exec(source.slice(i))
      if (match) {
        const name = match[1]!
        if (!(name in locals)) {
          errors.push({ file, path, message: `Unknown local '@${name}' in condition` })
          return source
        }
        const serialized = serializeLocal(locals[name])
        if (serialized === null) {
          errors.push({ file, path, message: `Local '@${name}' cannot be used in a condition` })
          return source
        }
        out += serialized
        i += match[0].length
        continue
      }
    }
    out += ch
    i += 1
  }
  return out
}
