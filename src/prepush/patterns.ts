import type { DenylistEntry } from './denylist.js'

export interface PrivacyMatch {
  location: string
  line: number
  rule: string
}

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g
const NOREPLY_RE = /^noreply@/i

const PRIVATE_HOSTNAME_RE =
  /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:internal|local|corp|lan|home|home\.arpa|intranet|private|ts\.net|tailscale\.net|amazonaws\.com|cloudfront\.net|ngrok\.io|ngrok-free\.app)\b/i

const PRIVATE_IP_RE =
  /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3})\b/

export function scanLine(
  text: string,
  location: string,
  line: number,
  entries: DenylistEntry[],
): PrivacyMatch[] {
  const matches: PrivacyMatch[] = []

  for (const entry of entries) {
    if (entry.regex.test(text)) {
      matches.push({ location, line, rule: `denylist entry #${entry.entryNumber}` })
    }
  }

  for (const match of text.matchAll(EMAIL_RE)) {
    if (!NOREPLY_RE.test(match[0])) {
      matches.push({ location, line, rule: 'built-in email' })
      break
    }
  }

  if (PRIVATE_HOSTNAME_RE.test(text) || PRIVATE_IP_RE.test(text)) {
    matches.push({ location, line, rule: 'built-in hostname' })
  }

  return matches
}
