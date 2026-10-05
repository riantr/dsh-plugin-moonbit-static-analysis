/**
 * DeepSeek Harness plugin for riantr/moonbit_static_analysis.
 *
 * Exposes the three-inspection pipeline (structural / type / behavior) to the
 * agent as ordinary tools. All analyzer semantics stay in MoonBit: the tools
 * spawn the module's `src/jsoncli` bridge (a Node-runnable JS bundle built by
 * `moon build --target js`) and the module's own gate commands. The plugin is
 * a spawner and a formatter, never a second implementation.
 *
 * @module @local/moonbit-static-analysis
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** Service the plugin registers into; plugin loading is inert without tools. */
export const inject = ['tools']

const DEFAULT_TIMEOUT_MS = 60_000
const GATE_TIMEOUT_MS = 300_000

/** Resolve the analyzer checkout from the row config (forward slashes ok). */
function projectDirOf(config) {
  const dir = config && config.projectDir
  if (typeof dir !== 'string' || dir.length === 0) {
    throw new Error('moonbit-static-analysis plugin: config.projectDir is required')
  }
  return path.resolve(dir)
}

/**
 * Resolve a runnable Node. Inside the Electron host `process.execPath` is the
 * app binary, so prefer the bundled runtime node when present.
 */
function nodePathOf(config) {
  if (typeof config?.nodePath === 'string' && existsSync(config.nodePath)) return config.nodePath
  const resources = process.resourcesPath
  if (typeof resources === 'string') {
    const candidate = path.join(
      resources,
      'runtime',
      'primary-runtime',
      'dependencies',
      'node',
      'bin',
      process.platform === 'win32' ? 'node.exe' : 'node',
    )
    if (existsSync(candidate)) return candidate
  }
  return process.execPath
}

/** Resolve the moon binary; CreateProcess appends .exe on Windows. */
function moonPathOf(config) {
  if (typeof config?.moonPath === 'string' && config.moonPath.length > 0) return config.moonPath
  return 'moon'
}

/** One spawned process: collected stdout/stderr, exit code, signal support. */
function runProcess(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      windowsHide: true,
      ...(options.signal ? { signal: options.signal } : {}),
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

const BRIDGE_RELATIVE = path.join('_build', 'js', 'debug', 'build', 'src', 'jsoncli', 'jsoncli.js')

/** Build the bridge on first use, then reuse the bundle. */
async function ensureBridge(projectDir, config) {
  const bridge = path.join(projectDir, BRIDGE_RELATIVE)
  if (existsSync(bridge)) return bridge
  const result = await runProcess(moonPathOf(config), ['build', '--target', 'js'], {
    cwd: projectDir,
    timeoutMs: GATE_TIMEOUT_MS,
  })
  if (!existsSync(bridge)) {
    throw new Error(
      `jsoncli bridge missing after build in ${projectDir}: ${result.stderr.trim() || result.stdout.trim() || 'no output'}`,
    )
  }
  return bridge
}

/** One JSON request through the bridge; replies are parsed JSON envelopes. */
async function callBridge(projectDir, config, request, signal) {
  const bridge = await ensureBridge(projectDir, config)
  const result = await runProcess(nodePathOf(config), [bridge, JSON.stringify(request)], {
    cwd: projectDir,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    signal,
  })
  const line = result.stdout.trim().split('\n').pop() ?? ''
  let reply
  try {
    reply = JSON.parse(line)
  } catch {
    throw new Error(
      `bridge reply unparseable (exit ${result.code}): ${line.slice(0, 200) || result.stderr.trim().slice(0, 200)}`,
    )
  }
  if (reply.ok !== true) {
    throw new Error(`bridge reported failure: ${String(reply.error ?? 'unknown error')}`)
  }
  return reply
}

/** Flatten a reply into the model-visible text. */
function reportText(title, reply) {
  const summary = `${title}: ${reply.count} finding(s)\n\n${reply.rendered}`
  return summary.trimEnd()
}

/**
 * Register the module's tools on the host tool registry.
 *
 * @param ctx - registrant context carrying `ctx.tools`.
 * @param config - the row config: `projectDir` (required), `nodePath`, `moonPath`.
 */
export function apply(ctx, config) {
  const projectDir = projectDirOf(config)

  ctx.tools.register(
    defineTool({
      name: 'moonbit_analyze',
      description:
        'Run the three-inspection pipeline (structural / type / behavior) over MoonBit-subset source text and return the merged report: one line per finding with position, severity, family, lens union, and virtual stacks. Use for program-code revision of the fast-evolving MoonBit language.',
      parameters: {
        source: {
          type: 'string',
          required: true,
          description: 'Program text in the analyzer-supported MoonBit subset.',
        },
        filename: {
          type: 'string',
          description: 'Reported file name for positions (default "main.mbt").',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            report: { type: 'string' },
            count: { type: 'integer' },
            findings: { type: 'json' },
          },
          required: ['report', 'count'],
        },
        render: (_args, value) => [{ type: 'text', text: value.report }],
      },
      async execute(args, exec) {
        const reply = await callBridge(
          projectDir,
          config,
          { kind: 'program', source: args.source, filename: args.filename ?? 'main.mbt' },
          exec.signal,
        )
        return { report: reportText('program findings', reply), count: reply.count, findings: reply.findings }
      },
      timeoutMs: DEFAULT_TIMEOUT_MS,
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'moonbit_analyze_file',
      description:
        'Analyze any MoonBit toolchain file kind by extension, not just program source. Dispatch: .mbt/.mbtx (three-inspection, plus the import block for a .mbtx script), .mbt.md (literate — only the fences the toolchain compiles, i.e. mbt and mbt check; mbt nocheck and a bare moonbit are display-only and skipped, and line numbers are the .md file\'s real lines), .mbti (interface audit: malformed lines, duplicate signatures, unknown type references), .mbtp (proof-file logic lint: string constants in bodies, banned !/iff forms, cross-package calls, lemma without proof_ensure — a lint, not a substitute for moon prove). Use this for interface files, literate docs and proof files; use moonbit_analyze for plain program source.',
      parameters: {
        source: {
          type: 'string',
          required: true,
          description: 'Full text of the file to analyze.',
        },
        filename: {
          type: 'string',
          required: true,
          description:
            'The file name; its extension selects the analysis (.mbt, .mbtx, .mbt.md, .mbti, .mbtp).',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            report: { type: 'string' },
            count: { type: 'integer' },
            findings: { type: 'json' },
          },
          required: ['report', 'count'],
        },
        render: (_args, value) => [{ type: 'text', text: value.report }],
      },
      async execute(args, exec) {
        const reply = await callBridge(
          projectDir,
          config,
          { kind: 'file', source: args.source, filename: args.filename },
          exec.signal,
        )
        return {
          report: reportText(`file findings (${args.filename})`, reply),
          count: reply.count,
          findings: reply.findings,
        }
      },
      timeoutMs: DEFAULT_TIMEOUT_MS,
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'moonbit_audit',
      description:
        'Audit a state machine through the same three inspections (static state revision): states are bindings, the drive-slot contract, and the course as abstract execution with virtual stacks. Pass machine tables as plain data; returns merged machine defects (dangling endpoints, undeclared triggers, empty or silent blocks, unreachable states, ambiguous drives, stranded course steps).',
      parameters: {
        spec: {
          type: 'json',
          required: true,
          description:
            'MachineSpec object: name, states[], initial, terminal, transitions[[from,trigger,to]], trigger_slots[[trigger,slot]], slot_names[], blocks[[state,slot,reason]], course[].',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            report: { type: 'string' },
            count: { type: 'integer' },
            findings: { type: 'json' },
          },
          required: ['report', 'count'],
        },
        render: (_args, value) => [{ type: 'text', text: value.report }],
      },
      async execute(args, exec) {
        const reply = await callBridge(projectDir, config, { kind: 'machine', spec: args.spec }, exec.signal)
        return { report: reportText('machine findings', reply), count: reply.count, findings: reply.findings }
      },
      timeoutMs: DEFAULT_TIMEOUT_MS,
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'moonbit_gates',
      description:
        'Run the module gate suite with the local toolchain: analyzer = moon check + fmt --check + test --target js; pyroduct = the reference consumer (its check/fmt/test). Returns per-command exit codes and the test totals. Use before and after changing the pipeline or the published package.',
      parameters: {
        suite: {
          type: 'string',
          required: true,
          enum: ['analyzer', 'pyroduct', 'all'],
          description: 'Which module to gate.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            summary: { type: 'string' },
            failed: { type: 'integer' },
          },
          required: ['summary', 'failed'],
        },
        render: (_args, value) => [{ type: 'text', text: value.summary }],
      },
      async execute(args, exec) {
        const suites = []
        if (args.suite === 'analyzer' || args.suite === 'all') {
          suites.push({ label: 'analyzer', cwd: projectDir, specs: [['check'], ['fmt', '--check'], ['test', '--target', 'js']] })
        }
        if (args.suite === 'pyroduct' || args.suite === 'all') {
          const consumer = path.join(path.dirname(projectDir), 'pyroduct')
          if (!existsSync(consumer)) {
            return { summary: `pyroduct consumer not found next to ${projectDir}`, failed: 1 }
          }
          suites.push({ label: 'pyroduct', cwd: consumer, specs: [['check'], ['fmt', '--check'], ['test']] })
        }
        const lines = []
        let failed = 0
        for (const suite of suites) {
          for (const spec of suite.specs) {
            let outcome
            try {
              outcome = await runProcess(moonPathOf(config), spec, {
                cwd: suite.cwd,
                timeoutMs: GATE_TIMEOUT_MS,
                signal: exec.signal,
              })
            } catch (error) {
              failed += 1
              lines.push(`${suite.label}: moon ${spec.join(' ')} -> spawn error: ${String(error)}`)
              continue
            }
            if (outcome.code !== 0) failed += 1
            const tail = `${outcome.stdout}\n${outcome.stderr}`
              .split('\n')
              .map((line) => line.trim())
              .filter((line) => line.length > 0)
              .slice(-3)
              .join(' / ')
            lines.push(`${suite.label}: moon ${spec.join(' ')} -> exit ${outcome.code}${tail ? ` | ${tail}` : ''}`)
          }
        }
        return { summary: lines.join('\n'), failed }
      },
      timeoutMs: GATE_TIMEOUT_MS,
    }),
  )
}
