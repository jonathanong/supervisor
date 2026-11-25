import { tokenizeCondition, type Token } from './condition-tokenizer.js'
import {
  NUMERIC_FACTS,
  validateComparison,
  type ConditionParseOptions,
} from './condition-validate.js'
import {
  POLICY_LIMITS,
  type ClassifierCall,
  type ComparisonOp,
  type ConditionExpr,
  type ConditionLhs,
  type ConditionRhs,
  type Quantifier,
} from './types.js'

class Parser {
  private pos = 0
  constructor(
    private readonly tokens: Token[],
    private readonly opts: ConditionParseOptions,
  ) {}
  private peek(): Token {
    return this.tokens[this.pos]!
  }
  private next(): Token {
    return this.tokens[this.pos++]!
  }

  parse(): ConditionExpr {
    const expr = this.parseLogical(0)
    if (this.peek().kind !== 'eof') {
      throw new Error(`Unexpected token '${this.peek().value}' at position ${this.peek().pos}`)
    }
    return expr
  }

  private parseLogical(depth: number): ConditionExpr {
    const items: ConditionExpr[] = [this.parsePrimary(depth)]
    let op: 'AND' | 'OR' | undefined
    while (
      this.peek().kind === 'word' &&
      (this.peek().value === 'AND' || this.peek().value === 'OR')
    ) {
      const nextOp = this.next().value as 'AND' | 'OR'
      if (op && op !== nextOp)
        throw new Error('Cannot mix AND and OR at the same level; use parentheses')
      op = nextOp
      items.push(this.parsePrimary(depth))
    }
    return op ? { kind: 'logical', op, items } : items[0]!
  }

  private parsePrimary(depth: number): ConditionExpr {
    const tok = this.peek()
    if (tok.kind === 'lparen') {
      if (depth + 1 > POLICY_LIMITS.maxParenDepth) {
        throw new Error(`Parenthesis nesting exceeds maximum of ${POLICY_LIMITS.maxParenDepth}`)
      }
      this.next()
      const inner = this.parseLogical(depth + 1)
      if (this.peek().kind !== 'rparen')
        throw new Error(`Expected ')' at position ${this.peek().pos}`)
      this.next()
      return inner
    }
    if (tok.kind === 'word' && (tok.value === 'true' || tok.value === 'false')) {
      this.next()
      return { kind: 'literal', value: tok.value === 'true' }
    }
    if (tok.kind === 'word' && tok.value === 'NOT')
      throw new Error('NOT operator is not supported in conditions')
    return this.parseComparison()
  }

  private parseComparison(): ConditionExpr {
    const quantifier =
      this.peek().kind === 'word' && (this.peek().value === 'ANY' || this.peek().value === 'ALL')
        ? (this.next().value as Quantifier)
        : undefined
    const lhs = this.parseLhs()
    const opTok = this.next()
    if (opTok.kind !== 'op')
      throw new Error(`Expected comparison operator at position ${opTok.pos}`)
    const op = opTok.value as ComparisonOp
    const rhs = this.parseRhs()
    validateComparison(quantifier, lhs, op, rhs, this.opts)
    return quantifier
      ? { kind: 'comparison', quantifier, lhs, op, rhs }
      : { kind: 'comparison', lhs, op, rhs }
  }

  private parseLhs(): ConditionLhs {
    const tok = this.next()
    if (tok.kind !== 'word')
      throw new Error(`Expected fact or classifier name at position ${tok.pos}`)
    const name = tok.value
    return name === 'claude/code_review' || name === 'claude/diff' || name.startsWith('repo/')
      ? { kind: 'classifier', call: this.parseClassifierTail(name) }
      : { kind: 'fact', name }
  }

  private parseClassifierTail(raw: string): ClassifierCall {
    const at = raw.indexOf('@')
    const name = at === -1 ? raw : raw.slice(0, at)
    let version: number | undefined
    if (at !== -1) {
      const verStr = raw.slice(at + 1)
      if (!/^[1-9][0-9]*$/.test(verStr)) throw new Error(`Invalid classifier version '${verStr}'`)
      version = Number(verStr)
    }
    const inputs: Record<string, string | number | string[]> = {}
    if (this.peek().kind === 'lparen') {
      this.next()
      while (this.peek().kind !== 'rparen') {
        const key = this.next()
        const eq = this.next()
        if (key.kind !== 'word' || eq.kind !== 'op' || eq.value !== '=') {
          throw new Error(`Expected 'key=value' in classifier call at position ${key.pos}`)
        }
        inputs[key.value] = this.parseInputValue()
        if (this.peek().kind === 'comma') this.next()
        else if (this.peek().kind !== 'rparen')
          throw new Error(`Expected ',' or ')' at position ${this.peek().pos}`)
      }
      this.next()
    }
    let output: string | undefined
    if (this.peek().kind === 'dot') {
      this.next()
      const outTok = this.next()
      if (outTok.kind !== 'word') throw new Error("Expected output name after '.'")
      output = outTok.value
    }
    return {
      name,
      ...(version !== undefined ? { version } : {}),
      inputs,
      ...(output !== undefined ? { output } : {}),
    }
  }

  private parseInputValue(): string | number | string[] {
    if (this.peek().kind === 'lbracket') return this.parseList()
    const tok = this.next()
    if (tok.kind === 'number') return Number(tok.value)
    if (tok.kind === 'word' || tok.kind === 'string') return tok.value
    throw new Error(`Invalid classifier input value at position ${tok.pos}`)
  }

  private parseRhs(): ConditionRhs {
    if (this.peek().kind === 'lbracket') return { kind: 'list', items: this.parseList() }
    const tok = this.next()
    if (tok.kind === 'number') return { kind: 'number', value: Number(tok.value) }
    if (tok.kind === 'string') return { kind: 'string', value: tok.value }
    if (tok.kind === 'word') {
      return NUMERIC_FACTS.has(tok.value)
        ? { kind: 'fact', name: tok.value }
        : { kind: 'string', value: tok.value }
    }
    throw new Error(`Expected right-hand value at position ${tok.pos}`)
  }

  private parseList(): string[] {
    this.next()
    const items: string[] = []
    while (this.peek().kind !== 'rbracket') {
      const tok = this.next()
      if (tok.kind !== 'word' && tok.kind !== 'string' && tok.kind !== 'number') {
        throw new Error(`Unexpected list item at ${tok.pos}`)
      }
      items.push(tok.value)
      if (this.peek().kind === 'comma') this.next()
      else if (this.peek().kind !== 'rbracket') throw new Error(`Expected ',' or ']'`)
    }
    this.next()
    if (items.length > POLICY_LIMITS.maxListEntries) throw new Error('List exceeds max entries')
    return items
  }
}

export function parseCondition(source: string, opts: ConditionParseOptions = {}): ConditionExpr {
  if (source.length > POLICY_LIMITS.maxConditionLength)
    throw new Error('Condition exceeds maximum length')
  return new Parser(tokenizeCondition(source), opts).parse()
}

export function parseClassifierRef(source: string): ClassifierCall {
  const comp = parseCondition(`${source} = pass`)
  if (comp.kind !== 'comparison' || comp.lhs.kind !== 'classifier') {
    throw new Error(`Expected classifier reference, got '${source}'`)
  }
  return comp.lhs.call
}
