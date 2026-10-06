# @riantr/moonbit-static-analysis-dsh

DeepSeek Harness 插件包（bundle，npm `@riantr/moonbit-static-analysis-dsh`）：把 `riantr/moonbit_static_analysis` 的**三鉴（结构/类型/行为）**流水线
以 agent 工具形式挂进当前 profile。插件本体是**生成器 + 格式化器**，不含第二套分析实现——所有分析语义
都留在 MoonBit 侧（`src/jsoncli` 桥接程序），随模块一起版本化、跑门禁、发布。

## 提供的工具

| 工具 | 作用 | 实现路径 |
|---|---|---|
| `moonbit_analyze` | 修订一段 MoonBit 子集程序源码（未定义名、未用绑定、类型错配、死分支、不可达），返回合并报告（位置 / 严重度 / family / lens 并集 / 虚栈） | 生成 `src/jsoncli` 桥 → `kind:"program"` 请求 |
| `moonbit_analyze_file` | **按扩展名分派**分析工具链的其它文件种类：`.mbt`/`.mbtx`（三鉴 + 脚本 import 块回显）、`.mbt.md`（literate，**只分析会被编译的围栏**，行号对齐到 `.md` 真实行）、`.mbti`（接口审计：畸形行 / 重复签名 / 未知类型引用）、`.mbtp`（证明文件逻辑 lint，**不替代 `moon prove`**） | 同上 → `kind:"file"` 请求 |
| `moonbit_audit` | 静态状态修订：任意状态机的纯数据 `MachineSpec` 过三鉴（状态即绑定 / 驱动槽契约 / 轨迹虚栈），含歧义驱动（同 `(state, trigger)` 多去向）检查 | 同上 → `kind:"machine"` 请求 |
| `moonbit_gates` | 跑门禁套件：`moon check` / `moon fmt --check` / `moon test`（analyzer 用 `--target js`；pyroduct 为参考消费方） | 直接生成 `moon` |

## 配置（`cordis.patch.yml` 里的行配置）

```yaml
config:
  projectDir: 'D:/src/DeepseekHarness/Projects/xiuyueren/StaticAnalysis/moonbit_static_analysis'  # 必填
  nodePath: 'C:/path/to/node.exe'   # 可选：默认解析 Electron 随包 node，再退到 process.execPath
  moonPath: 'moon'                  # 可选：默认 `moon`（PATH 解析）
```

首次调用分析工具时若桥未构建，插件会自动在该目录执行 `moon build --target js`
（产物 `_build/js/debug/build/src/jsoncli/jsoncli.js`），之后直接复用。

## 安装

**方式一：npm 包（可搜索、可固定版本）**——在任意 profile 的插件页「添加插件」输入包名，或命令行：

```
dsh plugin --profile <name> add @riantr/moonbit-static-analysis-dsh
dsh plugin --profile <name> add @riantr/moonbit-static-analysis-dsh@0.1.4
```

**方式二：GitHub 仓库**——git 地址同样接受（`installBundle` 自带 GitHub 预检）：

```
dsh plugin --profile <name> add github:riantr/dsh-plugin-moonbit-static-analysis#v0.1.4
dsh plugin --profile <name> add https://github.com/riantr/dsh-plugin-moonbit-static-analysis.git
```

**方式三：本地目录**——在带 `plugin_manager` 工具的会话里：

```
plugin_manager action=install_bundle target=<本目录绝对路径>
```

或在 Web GUI 的 Plugin Manager 里选择「从目录安装 bundle」指向本目录。安装影响该 profile 的全部会话并跨重启保留；
替换已安装包需要重启才会加载新的 JS 模块代。

**配置 projectDir**：npm/git 安装后该包位于 profile 的 node_modules 内，`cordis.patch.yml` 里的
`config.projectDir` 指向的是**开发机**的分析器检出——其他用户安装后需在插件页的配置编辑器里把它改成本地的
`moonbit_static_analysis` 检出路径（或在该检出目录上 `moon build --target js` 生成桥，插件会自动补建）。
本地目录安装（方式三）开箱即用。

> 不要手写 profile 的 `package.json` / `cordis.patch.yml`，也不要在 profile 目录里跑 pnpm——`install_bundle`
> 会完成这些步骤。`@deepseek-ai/dsh-tools` 随 dsh 安装解析，本包不声明依赖。

## 发布

npm：`npm publish`（public，scope `@riantr`；v0.1.4 起，含 `moonbit_analyze_file`）。GitHub：master + tag v0.1.x 双同步。

## 已验证

- `npm test`（`test-register.mjs` + `test-bridge.mjs`，两者都不进发布 tarball）✓
- `node --check index.js` / `node --check test-bridge.mjs` ✓
- 以桩 `defineTool` 端到端运行 `apply()`：注册 4 个工具，且**不多不少**（`test-register.mjs`
  用一个 `node:module` resolve hook 把 `@deepseek-ai/dsh-tools` 换成 identity 桩，
  因此不需要宿主就能跑真实的 `apply()`）✓
- `test-bridge.mjs`：7/7 桥接用例全过（覆盖 `kind:"program"` 与 `kind:"file"` 的每条分派）✓
  - `missing(x)` → `UndefinedName` + 虚栈 `in g at main.mbt:1` ✓
  - `.mbtx`：import 块按 `"path" @alias *` 原样回显，正文缺陷同时报出 ✓
  - `.mbti`：未知类型引用报出；一份**真实生成**的 `.mbti`（含 `pub let` / `suberror` /
    `#deprecated` / `impl ... for` / `noraise cancel` / `const` / `using`）零误报 ✓
  - `.mbt.md`：只有**工具链真的编译**的围栏才分析，即 `mbt check` / `mbt test`；
    `mbt nocheck` 与**裸 `mbt` / 裸 `moonbit`** 展示块一律跳过 ✓
    （真值表见分析器 `fence_mode`：`moon check` 实测，不靠文档措辞。裸 `mbt`
    展示块曾被当作活代码分析，那是在工具链从不构建的代码上报假缺陷）
- `moonbit_audit` 真跑：歧义驱动 `('b' vs 'c')` + `step(c, act) blocks without a reason` ✓
- `moonbit_gates suite=analyzer`：check / fmt --check / test 75/75 全 exit 0；首轮还如实报出未格式化的
  `src/jsoncli/main.mbt`（随后 `moon fmt` 修复）——失败路径同样经过验证 ✓

## 测试

```console
npm test        # 桩宿主跑 apply() 注册检查 + 7 条桥接往返用例
```

> **前置：分析器必须是本仓的同级目录。** 两个测试脚本都把
> `PROJECT_DIR` 解析成 `<本仓>/../moonbit_static_analysis`，而 `test-bridge.mjs`
> 还要求那里已存在 `_build/js/debug/build/src/jsoncli/jsoncli.js`，
> 也就是要先在分析器里跑过一次 `moon build --target js`。`index.js` 自己也会
> spawn `moon` 二进制。这不是巧合，是插件与模块之间的目录约定；CI 里由
> `.github/actions/analyzer-test` 把分析器 checkout 成同级目录来满足。

`test-register.mjs` 用 `node:module` 的 resolve hook 把 `@deepseek-ai/dsh-tools` 换成
identity 桩，于是真实的 `apply()` 能在裸 Node 里执行——注册的工具名与数量都被断言。
`test-bridge.mjs` 直接打真实的 `jsoncli` 桥，每种文件种类各一条用例，外加一条用**真实
生成**的 `.mbti` 验证零误报。两者都在 `files` 白名单之外，不进发布 tarball。

## 关系

- 模块侧前置：`src/jsoncli`（本工作区 `moonbit_static_analysis/src/jsoncli/`，随模块发布）。
- 本地技能：`moonbit_static_analysis/.dsh/skills/moonbit-static-analysis/SKILL.md`（给 agent 的用法约定，与此插件互补）。
- mooncakes 技能：`src/cli/SKILL.md`（`moonx riantr/moonbit_static_analysis/src/cli`）。
- pyroduct 是**被测对象**：本插件与分析器都不依赖它，`moonbit_gates` 只在其目录上跑门禁。
