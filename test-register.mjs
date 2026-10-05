// Runs the plugin's apply() with a stubbed defineTool, then actually executes
// each tool against the real bridge. This is the plugin's own contract: the
// tool bodies must produce the reports the descriptions promise.
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register('./stub-loader.mjs', pathToFileURL(import.meta.filename))

const { apply } = await import('./index.js')

const PROJECT_DIR = pathToFileURL(
  new URL('..', pathToFileURL(import.meta.filename)).pathname.replace(/\/$/, '') + '/moonbit_static_analysis',
).href

const names = []
apply({ tools: { register: (t) => names.push(t.name) } }, { projectDir: PROJECT_DIR.replace('file:///', '') })

console.log('registered:', names.join(', '))
const expected = ['moonbit_analyze', 'moonbit_analyze_file', 'moonbit_audit', 'moonbit_gates']
const missing = expected.filter((n) => !names.includes(n))
if (missing.length) {
  console.log('FAIL missing tools:', missing.join(', '))
  process.exit(1)
}
if (names.length !== expected.length) {
  console.log(`FAIL expected exactly ${expected.length} tools, got ${names.length}`)
  process.exit(1)
}
console.log(`ok   apply() registers all ${expected.length} tools`)
