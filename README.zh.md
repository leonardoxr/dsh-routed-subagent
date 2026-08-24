# dsh-routed-subagent

[English](README.md) | 简体中文

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 提供基于白名单的模型与推理路由。
每次委派调用都必须同时选择：

- 通过 `model` 选择一个已配置的模型策略；以及
- 通过 `reasoning_effort` 选择一个由适配器拥有的精确 effort。

插件会先依据本地策略和 `ctx.llm.resolveCallConfig()` 验证该组合，然后才创建子代理。绝不接受任意的提供商/模型透传。

## 安装

```sh
dsh plugin --profile <your-profile> add github:leonardoxr/dsh-routed-subagent#v0.3.0
# or use the packed asset from the GitHub release / a local checkout:
dsh plugin --profile <your-profile> add C:/path/to/dsh-routed-subagent-0.3.0.tgz
```

## 配置

在你的 profile patch 中定位 `routed-subagent` 行。必须配置 `models` 和 `rootModels` 才能启用委派。未配置它们的全新安装仍会正常启动并显示其设置卡片，但在你配置完整策略之前不会注册委派工具。

```yaml
- id: routed-subagent
  config:
    toolName: routed_subagent
    maxDepth: 2
    rootModels: [codex-mini, codex-sol]
    models:
      codex-mini:
        provider: openai-codex
        model: gpt-5.4-mini
        reasoningEfforts: [low, medium]
        maxTokens: 16384
        description: 'Mechanical edits, lookups, and summarization.'

      codex-sol:
        provider: openai-codex
        model: gpt-5.6-sol
        reasoningEfforts: [medium, high, xhigh]
        maxTokens: 65536
        description: 'Architecture, multi-step reasoning, and hard debugging.'
        spawnableModels: [codex-mini]
```

映射键（`codex-sol`）是调用代理通过 `model` 传递的短策略 id；它不会被发送给提供商。`provider` 和内部的 `model` 用于选择实际的适配器路由。

## 在应用中配置

**Settings → Plugins → Routed subagent** 可编辑完整的路由器配置：工具名称、后台任务支持、最大深度、根级可用性、模型策略、提供商/模型路由、token 上限、推理 effort 白名单、路由指导以及递归子代理权限。提供商/模型建议和 effort id 来自与 Chat 相同的实时 Host 目录；当目录不可用或有意不完整时，仍可编辑精确的自定义 id。

更改在点击 **Save changes** 之前均处于暂存状态。成功保存会为新调用热重挂载工具，并使子代理持有的、来自上一设置代次的递归权限失效。**Reset to composition** 会清除所有路由器覆盖项。

## 工具契约

已注册的工具接受：

| 字段 | 必需 | 含义 |
| --- | --- | --- |
| `description` | 是 | 简短的显示标签 |
| `prompt` | 是 | 完整且独立的子代理任务 |
| `model` | 是 | 此调用方上下文中允许的已配置模型策略 id |
| `reasoning_effort` | 是 | 该策略白名单中的精确 effort |
| `run_in_background` | 否 | 通过 Harness jobs 服务运行 |

前台和后台结果都会回显实际生效的 `{ id, provider, model, reasoningEffort }` 选择，以便审计。

## 配置参考

| 键 | 默认值 | 含义 |
| --- | --- | --- |
| `toolName` | `routed_subagent` | 已注册的工具名称 |
| `enableRunInBackground` | `true` | 暴露 `run_in_background` |
| `maxDepth` | `1` | 正有限数的绝对委派深度上限 |
| `rootModels` | 必需 | 顶层代理可用的非空策略 id 列表 |
| `models` | 必需 | 已配置的非空模型白名单 |
| `models.*.provider` | 必需 | 已注册的 LLM 提供商路由 |
| `models.*.model` | 必需 | 由提供商拥有的精确模型 id |
| `models.*.reasoningEfforts` | 必需 | 非空的精确 effort id 白名单 |
| `models.*.maxTokens` | — | 正数的输出 token 上限 |
| `models.*.description` | — | 向调用方显示的简短路由权衡说明 |
| `models.*.spawnableModels` | `[]` | 使用此模型的子代理可调用的策略 id |

配置是严格的：未知字段、重复 id、空白名单、不安全的数值和未知引用都会导致加载或保存失败。

## 递归与验证

- 仅使用本地 `spawn` 子代理提供商，因为请求级推理约束和递归权限需要一个实时子 `Agent`。
- 委派深度大于零的未跟踪代理不会获得任何模型权限。
- 子代理只会收到其所选策略的 `spawnableModels` 列表。
- 设置代次发生变化时，会撤销已在运行的子代理进行更深层委派的权限。
- 配置的 effort 会按子代理捕获并固定到每个 LLM 请求，因此并发子代理可以安全地使用不同的 effort。
- `ctx.llm.resolveCallConfig()` 会在创建子代理之前验证精确的提供商/模型/effort 组合。缺失的适配器、过期的模型 id 和不受支持的 effort id 都会在不生成子代理的情况下失败。

## 从 0.2 迁移

版本 0.3 有意引入破坏性变更，并且没有 tier 兼容层：

- `tiers` → `models`
- `rootTiers` → 必需的 `rootModels`
- tier 键 `guidance` → 模型策略 `description`
- tier 键 `spawnable` → `spawnableModels`
- 移除 `providerName`、`persona` 和静态 `reasoningEffort`
- 将工具参数 `tier` 替换为必需的 `model` 和 `reasoning_effort`
- 将 `maxDepth: provider-managed` 替换为正整数

## 安全说明

Harness 的 `/api` 信任边界用于防御 DNS 重绑定，而非身份验证。任何能够访问服务器的人都可以发起其代理可执行的工作。除非你接受这项支出，否则不要将昂贵的路由放入 `models`。

## 许可证

[MIT](LICENSE)
