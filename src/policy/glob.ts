function escapeRegexChar(ch: string): string {
  return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function unescapePattern(pattern: string): string {
  if (pattern.startsWith('\\@') || pattern.startsWith('\\!')) {
    return pattern.slice(1)
  }
  return pattern
}

export function validatePathPattern(raw: string): string | null {
  if (raw.length === 0) return 'Path pattern must not be empty'
  const isNeg = raw.startsWith('!')
  const body = isNeg ? raw.slice(1) : unescapePattern(raw)
  if (isNeg && (body.length === 0 || /^\s/.test(body))) {
    return 'Negated path pattern must not be empty or start with whitespace'
  }
  if (body.startsWith('/') || body.endsWith('/')) {
    return 'Path pattern must not have a leading or trailing slash'
  }
  if (body.startsWith('./') || body === '.' || body === '..') {
    return 'Path pattern must not use relative dot segments'
  }
  const segments = body.split('/')
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      return 'Path pattern contains an invalid path segment'
    }
    if (segment.includes('**') && segment !== '**') {
      return 'Double-star (**) must occupy a whole path segment'
    }
  }
  return null
}

function compileSegment(segment: string): string {
  let out = ''
  let i = 0
  while (i < segment.length) {
    const ch = segment[i]!
    if (ch === '\\' && i + 1 < segment.length) {
      out += escapeRegexChar(segment[i + 1]!)
      i += 2
    } else if (ch === '*') {
      out += '[^/]*'
      i += 1
    } else if (ch === '?') {
      out += '[^/]'
      i += 1
    } else if (ch === '{') {
      const close = segment.indexOf('}', i + 1)
      if (close === -1) {
        out += '\\{'
        i += 1
      } else {
        const alts = segment
          .slice(i + 1, close)
          .split(',')
          .map((alt) => compileSegment(alt))
        out += `(?:${alts.join('|')})`
        i = close + 1
      }
    } else if (ch === '[') {
      const close = segment.indexOf(']', i + 1)
      if (close === -1) {
        out += '\\['
        i += 1
      } else {
        out += segment.slice(i, close + 1)
        i = close + 1
      }
    } else {
      out += escapeRegexChar(ch)
      i += 1
    }
  }
  return out
}

export function matchGlob(filePath: string, rawPattern: string): boolean {
  const pattern = unescapePattern(rawPattern)
  const segments = pattern.split('/')
  const parts: string[] = []

  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i]!
    const isLast = i === segments.length - 1
    if (seg === '**') {
      if (segments.length === 1) {
        parts.push('.*')
      } else if (isLast) {
        // `dir/**` matches both `dir` itself and anything inside `dir/` (explain.md).
        parts.push('(?:/.*)?')
      } else {
        parts.push('(?:.*/)?')
      }
    } else {
      const prefix = i > 0 && segments[i - 1] !== '**' ? '/' : ''
      parts.push(`${prefix}${compileSegment(seg)}`)
    }
  }

  const regex = new RegExp(`^${parts.join('')}$`)
  return regex.test(filePath)
}

export function matchesRulePaths(relPath: string, patterns: string[]): boolean {
  // TODO(spec): confirm whether a positive pattern written after a `!` pattern re-includes files
  // or whether `!` items always exclude regardless of order (explain.md states "paths match, no '!' item takes the file out").
  let matchedPositive = false
  for (const raw of patterns) {
    if (raw.startsWith('!')) {
      if (matchGlob(relPath, raw.slice(1))) {
        return false
      }
    } else if (!matchedPositive && matchGlob(relPath, raw)) {
      matchedPositive = true
    }
  }
  return matchedPositive
}

export function toRelativePath(filePath: string, baseDir: string): string | null {
  const normalizedFile = filePath.replace(/^\/+|\/+$/g, '')
  const normalizedBase = baseDir.replace(/^\/+|\/+$/g, '')
  if (normalizedBase === '') return normalizedFile
  if (normalizedFile === normalizedBase) return ''
  if (normalizedFile.startsWith(`${normalizedBase}/`)) {
    return normalizedFile.slice(normalizedBase.length + 1)
  }
  return null
}
