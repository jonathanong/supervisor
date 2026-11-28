const REDACTED = '[REDACTED]'

interface RedactionRule {
  pattern: RegExp
  replace: (...args: string[]) => string
}

const TOKEN_PATTERNS: readonly RedactionRule[] = [
  {
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    replace: () => REDACTED,
  },
  {
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/g,
    replace: () => REDACTED,
  },
  {
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
    replace: () => REDACTED,
  },
  {
    pattern: /\b(?:sk-ant-[A-Za-z0-9_-]{20,}|sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,})\b/g,
    replace: () => REDACTED,
  },
  {
    pattern:
      /\b(?:(?:AKIA|ASIA)[0-9A-Z]{16}|npm_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{16,}|glpat-[A-Za-z0-9_-]{20,}|pypi-[A-Za-z0-9_-]{20,})\b/g,
    replace: () => REDACTED,
  },
  {
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    replace: () => REDACTED,
  },
  {
    pattern: /\b(Bearer|Basic|Token)([ \t]+)[A-Za-z0-9._~+/=-]{16,}/gi,
    replace: (_match, scheme, space) => `${scheme}${space}${REDACTED}`,
  },
  {
    pattern:
      /\b(Authorization|X-Api-Key)(\s*:\s*)(?:(Bearer|Basic|Token)([ \t]+))?(?!\[REDACTED\])([^\s,\r\n]{8,})/gi,
    replace: (_match, header, sep, scheme, space) =>
      `${header}${sep}${scheme ? `${scheme}${space}` : ''}${REDACTED}`,
  },
  {
    pattern: /([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/gi,
    replace: (_match, scheme) => `${scheme}${REDACTED}@`,
  },
  {
    pattern:
      /\b((?:[A-Za-z0-9_-]*[_-])?(?:token|secret|api[_-]?key|apikey|password|passwd|private[_-]?key|access[_-]?key|client[_-]?secret))(\s*=\s*)(?:(['"])(?!\[REDACTED\])[^'"\r\n]{8,}\3|(?!\[REDACTED\])[^\s'"\r\n]{8,})/gi,
    replace: (_match, key, sep, quote) => `${key}${sep}${quote}${REDACTED}${quote}`,
  },
  {
    pattern:
      /("(?:[A-Za-z0-9_-]*[_-])?(?:token|secret|api[_-]?key|apikey|password|passwd|private[_-]?key|access[_-]?key|client[_-]?secret)"\s*:\s*")(?!\[REDACTED\])([^"\r\n]{8,})(")/gi,
    replace: (_match, prefix, _secret, suffix) => `${prefix}${REDACTED}${suffix}`,
  },
]

export interface RedactionResult {
  text: string
  redacted: boolean
}

/** Strips token- and credential-like substrings, replacing them with `[REDACTED]`. */
export function stripCredentials(input: string): RedactionResult {
  let text = input
  let redacted = false
  for (const rule of TOKEN_PATTERNS) {
    const next = text.replace(rule.pattern, (...args: unknown[]) => {
      redacted = true
      const parts = args.slice(0, -2).map((arg) => (typeof arg === 'string' ? arg : ''))
      return rule.replace(...parts)
    })
    text = next
  }
  return { text, redacted }
}

/** Reports whether `input` contains anything that looks like a token or credential. */
export function containsCredential(input: string): boolean {
  return stripCredentials(input).redacted
}
