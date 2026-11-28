import { describe, expect, it } from 'vitest'
import { containsCredential, stripCredentials } from '../src/pr/redact.js'

describe('credential redaction', () => {
  it('strips every supported token and credential family', () => {
    const samples: Array<[string, string, string]> = [
      ['GitHub classic PAT', 'token ghp_1234567890abcdefghijklmnop123456', 'token [REDACTED]'],
      ['GitHub fine-grained PAT', 'github_pat_11ABCDEFG_0123456789abcdef0123456789', '[REDACTED]'],
      ['Anthropic key', 'sk-ant-api03-1234567890abcdefghijklmnop', '[REDACTED]'],
      ['OpenAI key', 'sk-proj-1234567890abcdefghijklmnop', '[REDACTED]'],
      ['AWS key', 'AKIAIOSFODNN7EXAMPLE', '[REDACTED]'],
      ['npm token', 'npm_1234567890abcdefghijklmnop', '[REDACTED]'],
      ['Slack token', 'xoxb-1234567890-abcdefghij', '[REDACTED]'],
      ['Google API key', 'AIzaSyDaGmWKa4JsXZ-HjGw7ISLn_3namBGewQe', '[REDACTED]'],
      ['Stripe key', 'sk_test_1234567890abcdefghij', '[REDACTED]'],
      ['GitLab PAT', 'glpat-1234567890abcdefghij', '[REDACTED]'],
      ['PyPI token', 'pypi-1234567890abcdefghij', '[REDACTED]'],
      ['JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop', '[REDACTED]'],
      ['Bearer header', 'Bearer abcdef1234567890abcdef', 'Bearer [REDACTED]'],
      ['Basic header', 'Basic dXNlcjpwYXNzMTIzNDU2Nzg=', 'Basic [REDACTED]'],
      ['Authorization header', 'Authorization: mycustomtoken123', 'Authorization: [REDACTED]'],
      [
        'Authorization Token header',
        'Authorization: Token myshorttoken12',
        'Authorization: Token [REDACTED]',
      ],
      ['X-Api-Key header', 'X-Api-Key: secretkeyvalue123', 'X-Api-Key: [REDACTED]'],
      [
        'URL credentials',
        'https://alice:supersecret@example.com/repo.git',
        'https://[REDACTED]@example.com/repo.git',
      ],
      ['Env var secret', 'GH_TOKEN=super_secret_value_123', 'GH_TOKEN=[REDACTED]'],
      ['Quoted env secret', 'api_key="super_secret_value_123"', 'api_key="[REDACTED]"'],
      [
        'JSON secret',
        '{"client_secret": "super_secret_value_123"}',
        '{"client_secret": "[REDACTED]"}',
      ],
      [
        'PEM private key block',
        '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----',
        '[REDACTED]',
      ],
      ['Bare PEM private key header', '-----BEGIN OPENSSH PRIVATE KEY-----', '[REDACTED]'],
    ]

    for (const [label, input, expected] of samples) {
      expect(containsCredential(input), label).toBe(true)
      const result = stripCredentials(input)
      expect(result.redacted, label).toBe(true)
      expect(result.text, label).toBe(expected)
      expect(containsCredential(result.text), `${label} idempotent`).toBe(false)
    }
  })

  it('leaves normal pull request text and provenance untouched', () => {
    const safeSamples = [
      'Add MCP PR tools with provenance comments',
      'https://github.com/jongleberry/supervisor/issues/17',
      '<!-- supervisor:provenance v1 -->\n- harness: claude-code\n- session: sess-abc-123',
      'Strip anything that looks like a token before writing.',
      'Already sanitized: [REDACTED]',
      'Commit sha 0123456789abcdef0123456789abcdef01234567',
    ]

    for (const sample of safeSamples) {
      expect(containsCredential(sample), sample).toBe(false)
      expect(stripCredentials(sample), sample).toEqual({ text: sample, redacted: false })
    }
  })
})
