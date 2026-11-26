import { registerHooks } from 'node:module'

// The runner's modules import each other, and `src/`, with `.js` specifiers, as the compiler
// requires. Node runs `scripts/*.ts` directly but cannot run `src/` uncompiled, so a relative
// `.js` specifier that does not exist resolves to the compiled file in `dist/` when it points
// into `src/`, and to its `.ts` source otherwise. Run `tsc -p tsconfig.build.json` first.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (err) {
      if (!specifier.startsWith('.') || !specifier.endsWith('.js')) throw err
      const target = new URL(specifier, context.parentURL).href
      const root = new URL('../', import.meta.url).href
      return target.startsWith(`${root}src/`)
        ? nextResolve(`${root}dist/${target.slice(root.length + 4)}`, context)
        : nextResolve(`${specifier.slice(0, -3)}.ts`, context)
    }
  },
})

const { main } = await import('./merge-classification/main.js')
process.exitCode = await main(process.argv.slice(2), (text) => process.stdout.write(text))
