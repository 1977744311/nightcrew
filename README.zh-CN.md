# nightcrew

[Language: English](README.md)

> 夜班里的编码代理。

你用普通 markdown 写下 BACKLOG，然后去睡觉。nightcrew 会把它变成有边界的计划，在隔离的 git worktree 中执行每个计划，用你的测试套件和独立审查代理把关每次合并，并在无人值守时一轮又一轮地落地已验证的工作。早上，`nightcrew report` 会告诉你落地了什么、失败了什么、花费了多少，以及还有哪些决策在等你。

它是围绕编码代理的控制平面，*不是*又一个代理。在 1.0 中，真正写代码的是代理（OpenAI Codex，通过官方 SDK 使用你现有的订阅）；nightcrew 负责所有不能让无人值守代理独自完成的事：限制写入范围、验证声明、审查 diff、停止循环失控，并为每一步保留持久账本。

## 为什么存在

交互式代理 CLI 是为人在回路中设计的。把它们单独留一晚，失败模式总是类似：跑出任务范围、没有证据却宣称完成、在同一个坏测试上空转六小时，或者悄悄烧完整个配额。nightcrew 的设计假设这些都会发生，并把每一种都变成**有类型、可恢复的事件**，而不是早上的意外：

| 无人值守失败模式 | nightcrew 的回答 |
| --- | --- |
| 代理跑偏 | 计划是有边界的工作单元，来自*你的* BACKLOG，并经过计划审查 |
| 没有证据就说“完成！” | 确定性的 verify profiles 把关每次落地；失败会降级为 `repair` |
| 自我批准的敷衍输出 | 独立合并审查在新会话中判断意图、范围和诚实性 |
| 无限重试螺旋 | Failure / no-commit / control-only 连续计数守卫用有类型原因停止循环 |
| 工作树被弄乱 | 所有代码工作都发生在每个计划独立的 git worktree 中；你的 checkout 保持干净 |
| 触碰不该改的内容 | 写入范围守卫会在提交前还原受保护路径的改动 |
| 凌晨 2 点烧光配额 | `quota_exhausted` 会按时间窗口安排恢复，而不是直接失败 |
| “昨晚发生了什么？” | 追加式 history + events 账本、实时 console、morning report |

## 快速开始

```bash
npm install -g nightcrew   # Node >= 22; needs git and a Codex subscription (codex login)

cd your-repo
nightcrew init             # scaffolds .nightcrew/ and registers the project
nightcrew doctor           # first-run sanity check: runtime, repo, config, registry, lock
$EDITOR .nightcrew/crew.md # write rules + BACKLOG items
nightcrew propose "goal"   # or: draft ready-to-ratify BACKLOG items from a goal, pick in-terminal

nightcrew run              # one supervised iteration, to build trust
nightcrew loop             # a bounded unattended session (default 20 iterations)
crew start                 # the real thing: daemon, all projects, schedule windows
nightcrew report           # the morning after
```

`.nightcrew/` 会随你的仓库提交（runtime state 和 worktrees 会被 git 忽略）。你的仓库*就是*数据库 — 删除这个目录，nightcrew 就像从未发生过。

## 一个夜晚如何运行

每次迭代都会解析一个 **operation** — 这是 config、state 和 console 中唯一的运行意图字段：

1. **plan** — 没有 active plan？从 BACKLOG 精确编写一个有边界的计划（或声明 IDLE）。计划审查会在接受前检查它是否被授权且有边界。
2. **execute** — 在计划自己的 worktree + branch（`nightcrew/<plan-id>`）里工作，并在多次迭代间恢复同一个 provider session。进度会在迭代结束时自动提交并做范围检查。
3. **verify** — 在 worktree 中运行确定性的门禁（你的命令：tests、typecheck、lint）。绿色是落地的前置条件，不是代理可以自称的结果。
4. **repair** — 任何有类型失败（verify red、merge conflict、review changes-requested、timeout……）都会变成下一次迭代的聚焦 brief。
5. **garden** — 周期性的控制面维护：清理过期 questions、整理 backlog，让小问题不要累积。

当一个计划完成且门禁为绿色时，合并审查者会在新会话中根据计划阅读完整 diff。批准的工作会合回去并清理 worktree；被拒绝的工作会变成 repair brief；真正模糊的事项会升级到 `questions.md` 并停止该计划 — 异步进行，不阻塞夜晚的其他工作。

标记为 `parallel: true` 的计划会在并发 worktree lane 中运行（受 `loop.maxParallelPlans` 限制）。`crew` daemon 会在你的 `schedule.windows`（例如 `"23:00-07:00"`）内同时驱动多个项目，每个仓库有一个项目锁，确保同一仓库不会被驱动两次。

## 控制面

你和 crew 之间说的所有内容都以 markdown 形式保存在你的仓库里：

```
.nightcrew/
  config.yaml        # the contract: provider, gates, guards, schedule
  crew.md            # your rules + BACKLOG (the only source of new work)
  questions.md       # 等你决策的问题，带可点选的字母选项
  qa.md              # 你记录的缺陷；loop 会自动分诊成 proposal
  plans/             # active/ completed/ paused/ — one markdown file per plan
  runtime/           # state.json, history.jsonl, events.jsonl (git-ignored)
  worktrees/         # per-plan checkouts (git-ignored)
```

早晨的例行动作收敛为 console 上的一个审批收件箱：open questions 会渲染
出各自的选项（选中带排期标记的选项会直接把工作写进 BACKLOG；留下反馈
则让 crew 下次运行重新起草选项），而 `qa.md` 里新增的缺陷 bullet 会在夜
里被自动分诊成一份待审 proposal（候选修复项）等你批准。每一条 BACKLOG
仍然能追溯到你的一次点击 — agent 永远不会写 `crew.md`。

## 命令

| 命令 | 作用 |
| --- | --- |
| `nightcrew init` | 搭建 `.nightcrew/`、修补 `.gitignore`、注册项目 |
| `nightcrew doctor` | 预检本地运行时、仓库、config、registry 和 daemon lock |
| `nightcrew run` | 运行一次迭代；`-o/--operation` 和 `-p/--plan` 可覆盖解析结果 |
| `nightcrew loop` | 迭代运行，直到守卫、预算或 operator 停止它 |
| `nightcrew status` | 查看 plans、streaks、worktrees、recent iterations |
| `nightcrew report` | 早晨摘要：landed、failed、cost、open questions |
| `nightcrew plan add <title>` | 创建 active plan 脚手架 |
| `nightcrew propose "<goal>"` | 单个 research pass 起草 BACKLOG candidates（`--lenses` 跑 3 个竞争 passes，`--from-qa` 从 qa.md 缺陷起草）；通过 checkbox TUI、`--ids 1,3` 或 console 选择。裸跑 `propose` 续审 pending 草稿；`--feedback "<text>"` 重新生成 |
| `nightcrew plan list/show` | 查看 plans |
| `nightcrew pause/resume` | 暂停 / 唤醒 loop（也可从 console 和 `crew` 操作） |
| `nightcrew console` | 本地 web console：board、history、token curve、live events、question 与 proposal 审批 |
| `nightcrew gc` | 清理 stale worktrees、sessions、old logs |
| `crew start` | 跨所有已注册项目运行 daemon；`--console` 会带 actions 提供 UI |
| `crew report` | 汇总所有已注册项目的 morning digest |
| `crew status` | 每个已注册项目一行状态 |

## 配置，20 行

```yaml
# .nightcrew/config.yaml
project:
  name: my-app
provider:
  codex:
    sandbox: workspace-write
verify:
  profiles:
    default:
      steps:
        - { name: test, run: npm test }
        - { name: typecheck, run: npx tsc --noEmit }
review:
  mode: gate          # off | advisory | gate
schedule:
  windows: ["23:00-07:00"]
loop:
  maxIterations: 40
```

每个 key 都会在加载时严格验证 — 拼写错误会在启动时响亮失败，而不是在凌晨 3 点静默错过。完整参考：[docs/configuration.md](docs/configuration.md)。概念和设计理由：[docs/concepts.md](docs/concepts.md)。

## 安全模型

代理被视为有窄契约的不受信任 worker：

- code ops 在 worktree 中运行，且不能触碰 `protectedPaths` 或 `.git`；
- control ops 在 main checkout 上运行，且*只能*触碰 `.nightcrew/`；
- 违规会在任何内容提交前被还原，并导致本次迭代失败；
- 落地到 base branch 需要：gates green、plan complete、review approval、clean main checkout — 四者每次都必须满足；
- daemon 持有每个项目的锁；两个 loops 永远不能驱动同一个 repo；
- 每次迭代都以账本记录结束：已验证进度或有类型失败。

## 库用法

CLI 是类型化库之上的薄外壳 — 每个接缝（provider、reviewer、scheduler、report）都会导出：

```ts
import { loadProject, buildProvider, buildReviewer, runIteration } from "nightcrew";

const ctx = loadProject(process.cwd());
const provider = buildProvider(ctx.config, ctx.root);
const record = await runIteration(ctx, { provider, reviewer: buildReviewer(ctx.config, provider, ctx.root) });
```

## 状态

1.0 将 Codex 作为唯一经过深度打磨的 executor，位于一个为更多 executor 设计的 provider interface 之后：Claude Code 和 Cursor adapters 是 1.0 之后的第一个里程碑（`Provider` 大约只需一个文件实现 — 见 `src/providers/`）。`operation` model、config schema、CLI surface 和 library exports 从 1.0.0 起按 semver 冻结。

## 许可证

MIT
