# @riantr/moonbit-static-analysis-dsh

DeepSeek Harness 插件包（bundle，npm `@riantr/moonbit-static-analysis-dsh`）：把 `riantr/moonbit_static_analysis` 的**三鉴（结构/类型/行为）**流水线
以 agent 工具形式挂进当前 profile。插件本体是**生成器 + 格式化器**，不含第二套分析实现——所有分析语义
都留在 MoonBit 侧（`src/jsoncli` 桥接程序），随模块一起版本化、跑门禁、发布。

## 提供的工具

| 工具 | 作用 | 实现路径 |
|---|---|---|
| `moonbit_analyze` | 修订一段 MoonBit 子集程序源码（未定义名、未用绑定、类型错配、死分支、不可达），返回合并报告（位置 / 严重度 / family / lens 并集 / 虚栈） | 生成 `src/jsoncli` 桥 → `kind:"program"` 请求 |
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
dsh plugin --profile <name> add @riantr/moonbit-static-analysis-dsh@0.1.3
```

**方式二：GitHub 仓库**——git 地址同样接受（`installBundle` 自带 GitHub 预检）：

```
dsh plugin --profile <name> add github:riantr/dsh-plugin-moonbit-static-analysis#v0.1.3
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

npm：`npm publish`（public，scope `@riantr`；v0.1.3 起）。GitHub：master + tag v0.1.x 双同步。

## 已验证

- `node --check index.js` ✓
- 以桩 `defineTool` 端到端运行 `apply()`：注册 3 个工具 ✓
- `moonbit_analyze` 真跑：`missing(x)` → `UndefinedName` + 虚栈 `in g at main.mbt:1` ✓
- `moonbit_audit` 真跑：歧义驱动 `('b' vs 'c')` + `step(c, act) blocks without a reason` ✓
- `moonbit_gates suite=analyzer`：check / fmt --check / test 21/21 全 exit 0；首轮还如实报出未格式化的
  `src/jsoncli/main.mbt`（随后 `moon fmt` 修复）——失败路径同样经过验证 ✓

## 关系

- 模块侧前置：`src/jsoncli`（本工作区 `moonbit_static_analysis/src/jsoncli/`，随模块发布）。
- 本地技能：`moonbit_static_analysis/.dsh/skills/moonbit-static-analysis/SKILL.md`（给 agent 的用法约定，与此插件互补）。
- mooncakes 技能：`src/cli/SKILL.md`（`moonx riantr/moonbit_static_analysis@0.1.2/src/cli`）。
- pyroduct 是**被测对象**：本插件与分析器都不依赖它，`moonbit_gates` 只在其目录上跑门禁。
