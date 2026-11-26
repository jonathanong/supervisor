/**
 * The in-page script that requests a dependency update check for each target repository. It
 * runs in a signed-in browser tab on the forge, after the three constants `updateCheckScript`
 * writes above it. It is kept as text because it is printed, never run here.
 */
export const UPDATE_CHECK_BODY = `
const P = new DOMParser()
const page = async (u) => P.parseFromString(await (await fetch(u)).text(), 'text/html')
const out = []
for (const [repo, ecos] of Object.entries(TARGETS)) {
  const list = await (await fetch(\`/\${ORG}/\${repo}/network/updates\`)).text()
  const ids = [...new Set([...list.matchAll(/network\\/updates\\/(\\d+)\\/jobs/g)].map((m) => m[1]))]
  if (!ids.length) {
    out.push(\`\${repo}: no update configs (signed out or no access?)\`)
    continue
  }
  for (const id of ids) {
    const url = \`/\${ORG}/\${repo}/network/updates/\${id}/jobs\`
    const doc = await page(url)
    const main = doc.querySelector('main')?.innerText ?? ''
    const eco = (main.match(/Export SBOM\\s+(\\S+)/) || [])[1] ?? '?'
    const file = (main.match(/Export SBOM\\s+\\S+\\s+(\\S+)/) || [])[1] ?? ''
    if (ecos && !ecos.includes(eco)) continue
    const label = \`\${repo} \${eco} \${file} [\${id}]\`
    const recent = (main.split('Recent jobs')[1] ?? '').replace(/\\s+/g, ' ').trim()
    if (/^\\S+ update \\d+ (Running now|Queued)/.test(recent)) {
      out.push(\`\${label}: already running\`)
      continue
    }
    const form = [...doc.querySelectorAll('form')].find((f) =>
      /Check for updates/.test(f.textContent),
    )
    if (!form) {
      out.push(\`\${label}: NO FORM (no permission or UI changed)\`)
      continue
    }
    if (DRY) {
      out.push(\`\${label}: would trigger\`)
      continue
    }
    const res = await fetch(form.getAttribute('action'), {
      method: 'POST',
      body: new FormData(form),
      headers: { Accept: 'text/html' },
    })
    const after = ((await page(url)).querySelector('main')?.innerText.split('Recent jobs')[1] ?? '')
      .replace(/\\s+/g, ' ')
      .trim()
    out.push(\`\${label}: POST \${res.status} -> \${after.slice(0, 60)}\`)
  }
}
out.join('\\n')
`
