// Exercise the plugin's tool wiring against the real bridge, without a DSH host.
// Mirrors index.js: the tool bodies are the contract, so run them directly.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_DIR = path.resolve(HERE, '..', 'moonbit_static_analysis')
const BRIDGE = path.join(
  PROJECT_DIR,
  '_build',
  'js',
  'debug',
  'build',
  'src',
  'jsoncli',
  'jsoncli.js',
)

if (!existsSync(BRIDGE)) {
  console.error('bridge not built; run `moon build --target js` in', PROJECT_DIR)
  process.exit(1)
}

function callBridge(request) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BRIDGE, JSON.stringify(request)], {
      cwd: PROJECT_DIR,
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c) => {
      stdout += c
    })
    child.stderr.on('data', (c) => {
      stderr += c
    })
    child.on('error', reject)
    child.on('close', (code) => {
      const line = stdout.trim().split('\n').pop() ?? ''
      try {
        resolve({ code, reply: JSON.parse(line), stderr })
      } catch {
        reject(new Error(`unparseable (exit ${code}): ${line.slice(0, 200)} ${stderr.slice(0, 200)}`))
      }
    })
  })
}

const CASES = [
  {
    name: 'program (.mbt) — undefined name',
    request: { kind: 'program', filename: 'main.mbt', source: 'fn f() -> int {\n  missing(1)\n}\n' },
    expectCount: 1,
    expectHas: 'missing',
  },
  {
    name: 'file (.mbt) — same as program',
    request: { kind: 'file', filename: 'main.mbt', source: 'fn f() -> int {\n  missing(1)\n}\n' },
    expectCount: 1,
    expectHas: 'missing',
  },
  {
    name: 'file (.mbtx) — import block echoed, body defect reported',
    request: {
      kind: 'file',
      filename: 'demo.mbtx',
      source:
        'import {\n  "moonbitlang/core/queue" @q *,\n}\nfn total(xs) -> int {\n  vanish(xs)\n}\n',
    },
    expectCount: 1,
    expectHas: 'moonbitlang/core/queue @q *',
  },
  {
    name: 'file (.mbti) — unknown type',
    request: { kind: 'file', filename: 'p.mbti', source: 'package "d"\npub fn f(Mystery) -> Int\n' },
    expectCount: 1,
    expectHas: "unknown type 'Mystery'",
  },
  {
    name: 'file (.mbtp) — string constant in a logic body',
    request: {
      kind: 'file',
      filename: 'p.mbtp',
      source: 'predicate is_hot(s : Severity) {\n  s.tag() == "hot"\n}\n',
    },
    expectCount: 1,
    expectHas: 'string constant',
  },
  {
    // Every block below is display-only EXCEPT the last one, and each carries a
    // different unbound name so the assertion can tell which one was reported.
    //
    // This fixture used to put the live code in a bare ```mbt fence and expect it
    // to be analysed. That is wrong, and it was wrong before this test ever ran:
    // the analyzer classifies fences by what the toolchain actually compiles
    // (see fence_mode in src/moonfiles/moonfiles.mbt), and the measured truth
    // table says `mbt check` / `mbt test` are compiled while a BARE `mbt` fence
    // is display-only, same as a bare `moonbit`. Analysing bare `mbt` produced
    // findings on code the toolchain never builds, which is the bug that fix
    // was for. So the case now checks the real rule in both directions: the
    // bare `mbt` block is a negative like the other display fences, and only
    // `mbt check` is analysed.
    name: 'file (.mbt.md) — only the check fence is compiled and reported',
    request: {
      kind: 'file',
      filename: 'doc.mbt.md',
      source:
        '```mbt nocheck\nfn a() -> int { gone(1) }\n```\n\n```moonbit\nfn b() -> int { gone(2) }\n```\n\n```mbt\nfn c() -> int { vanish(1) }\n```\n\n```mbt check\nfn d() -> int { elapse(3) }\n```\n',
    },
    expectCount: 1,
    expectHas: 'elapse',
  },
  {
    name: 'file (real generated .mbti) — clean',
    request: {
      kind: 'file',
      filename: 'pkg.generated.mbti',
      source:
        '// Generated using `moon info`, DON\'T EDIT IT\npackage "d"\n\npub let errno_ENOTSUP : Int\n\npub suberror PipeClosed derive(ToJson)\n#deprecated\npub impl Show for PipeClosed\n\ntype Decoder\npub async fn Decoder::write(Self, input_offset? : Int) -> (Int, Int) noraise cancel\npub const HEADER_SIZE : Int = 10\npub using @types {type Platform}\n',
    },
    expectCount: 0,
    expectHas: null,
  },
]

let failed = 0
for (const c of CASES) {
  const { code, reply, stderr } = await callBridge(c.request)
  const problems = []
  if (reply.ok !== true) problems.push(`ok=${reply.ok} err=${reply.error}`)
  if (code !== 0) problems.push(`exit=${code}`)
  if (reply.count !== c.expectCount) problems.push(`count=${reply.count} want=${c.expectCount}`)
  if (c.expectHas && !(reply.rendered ?? '').includes(c.expectHas)) {
    problems.push(`rendered missing ${JSON.stringify(c.expectHas)}`)
  }
  if (problems.length) {
    failed += 1
    console.log(`FAIL ${c.name}: ${problems.join('; ')}`)
    if (stderr.trim()) console.log(`     stderr: ${stderr.trim().slice(0, 200)}`)
  } else {
    console.log(`ok   ${c.name} (count=${reply.count})`)
  }
}

console.log(`\n${CASES.length - failed}/${CASES.length} bridge cases passed`)
process.exit(failed === 0 ? 0 : 1)
