// ESM resolve hook: redirect `@deepseek-ai/dsh-tools` to the inline stub, so
// the plugin's `apply()` runs in plain Node.
const STUB = 'data:text/javascript,' + encodeURIComponent(`
export function defineTool(tool) { return tool }
export default { defineTool }
`)

export function resolve(specifier, context, next) {
  if (specifier === '@deepseek-ai/dsh-tools') {
    return { url: STUB, shortCircuit: true }
  }
  return next(specifier, context)
}
