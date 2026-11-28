/**
 * Returns a per-line stripper that removes HTML comments, including ones that span lines.
 * Call it on each line in order; text inside a comment never reaches the caller.
 */
export function createCommentStripper(): (line: string) => string {
  let inComment = false
  return (line) => {
    let out = ''
    let rest = line
    for (;;) {
      if (inComment) {
        const close = rest.indexOf('-->')
        if (close === -1) return out
        rest = rest.slice(close + 3)
        inComment = false
      } else {
        const open = rest.indexOf('<!--')
        if (open === -1) return out + rest
        out += rest.slice(0, open)
        rest = rest.slice(open + 4)
        inComment = true
      }
    }
  }
}
