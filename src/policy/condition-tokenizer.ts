export type TokenKind =
  | 'word'
  | 'number'
  | 'string'
  | 'op'
  | 'lparen'
  | 'rparen'
  | 'lbracket'
  | 'rbracket'
  | 'comma'
  | 'dot'
  | 'eof'

export interface Token {
  kind: TokenKind
  value: string
  pos: number
}

const TWO_CHAR_OPS = new Set(['!=', '<=', '>='])
const ONE_CHAR_OPS = new Set(['=', '<', '>'])

export function tokenizeCondition(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < input.length) {
    const ch = input[i]!
    if (/\s/.test(ch)) {
      i += 1
      continue
    }
    const two = input.slice(i, i + 2)
    if (TWO_CHAR_OPS.has(two)) {
      tokens.push({ kind: 'op', value: two, pos: i })
      i += 2
      continue
    }
    if (ONE_CHAR_OPS.has(ch)) {
      tokens.push({ kind: 'op', value: ch, pos: i })
      i += 1
      continue
    }
    if (ch === '(') {
      tokens.push({ kind: 'lparen', value: ch, pos: i })
      i += 1
      continue
    }
    if (ch === ')') {
      tokens.push({ kind: 'rparen', value: ch, pos: i })
      i += 1
      continue
    }
    if (ch === '[') {
      tokens.push({ kind: 'lbracket', value: ch, pos: i })
      i += 1
      continue
    }
    if (ch === ']') {
      tokens.push({ kind: 'rbracket', value: ch, pos: i })
      i += 1
      continue
    }
    if (ch === ',') {
      tokens.push({ kind: 'comma', value: ch, pos: i })
      i += 1
      continue
    }
    if (ch === '.') {
      tokens.push({ kind: 'dot', value: ch, pos: i })
      i += 1
      continue
    }
    if (ch === "'") {
      const start = i
      i += 1
      let val = ''
      while (i < input.length && input[i] !== "'") {
        if (input[i] === '\\' && i + 1 < input.length) {
          val += input[i + 1]!
          i += 2
        } else {
          val += input[i]!
          i += 1
        }
      }
      if (i >= input.length) {
        throw new Error(`Unterminated string literal at position ${start}`)
      }
      i += 1
      tokens.push({ kind: 'string', value: val, pos: start })
      continue
    }
    if (/[0-9]/.test(ch)) {
      const start = i
      while (i < input.length && /[0-9]/.test(input[i]!)) {
        i += 1
      }
      tokens.push({ kind: 'number', value: input.slice(start, i), pos: start })
      continue
    }
    if (/[A-Za-z0-9_/:@!-]/.test(ch)) {
      const start = i
      while (i < input.length && /[A-Za-z0-9_/:@!-]/.test(input[i]!)) {
        i += 1
      }
      tokens.push({ kind: 'word', value: input.slice(start, i), pos: start })
      continue
    }
    throw new Error(`Unexpected character '${ch}' at position ${i}`)
  }

  tokens.push({ kind: 'eof', value: '', pos: input.length })
  return tokens
}
