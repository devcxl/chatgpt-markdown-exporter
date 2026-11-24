---
title: 围栏消息块渲染与选项接入
id: task-004
parent: 10
issue: null
depends_on: []
assignee: backend
status: ready
---

# task-004: 围栏消息块渲染与选项接入

## 目标

实现 `fenceMessages` 导出选项：开启后每条消息渲染为围栏代码块；关闭时输出与改动前逐字节一致。依据 `docs/dev/specs/fenced-message-blocks.md`。

## 范围

| 文件 | 操作 |
|---|---|
| `src/markdown/conversation-to-markdown.ts` | 修改（`MarkdownOptions`、`renderSectionBlock` / `renderFencedBlock`） |
| `src/markdown/conversation-render.test.ts` | 追加用例 |
| `src/markdown/conversation-to-markdown.test.ts` | 追加用例 |
| `src/shared/messages.ts` | `RequestExportConversationsMessage` 增加 `fenceMessages` |
| `src/entrypoints/background.ts` | 透传 |
| `src/entrypoints/chatgpt.content/index.ts` | 透传，页内导出写死 `fenceMessages: false` |
| `src/entrypoints/popup/index.html` | 新增 checkbox |
| `src/entrypoints/popup/index.ts` | 读取并传递 |
| `src/locales/en.json`、`src/locales/zh_CN.json` | 新增 `options.fenceMessages` |

## 实现要点

1. `MarkdownOptions` 增加必填 `fenceMessages: boolean`——编译器会指出所有构造处，逐处补齐
2. 新增纯函数 `fenceMessageBlock(author, timestamp, body): string`：
   - `n = max(3, 正文最长连续反引号数 + 1)`
   - 首行 `author` 或 `author · HH:MM`，与正文之间一个空行
3. `renderContent` 按 `options.fenceMessages` 分流到 `renderFencedBlock` / `renderSectionBlock`；后者即原 `renderMessageBlock`，拼接逻辑**原样不动**
4. `messageCount` 口径不变
5. i18n：`options.fenceMessages` = `Render each message as a fenced code block` / `每条消息渲染为围栏代码块`

## 测试（依据 spec §5）

| 用例 | 断言 |
|---|---|
| 关闭 | 输出含 `---`、`## 角色` |
| 开启，纯文本 | 3 反引号 + `text`，首行角色名 |
| 开启，正文含 ` ```ts ` | 外层 4 反引号，内层原样 |
| 开启，正文含 4 连反引号 | 外层 5 反引号 |
| 开启 + 时间戳 | 首行 `角色 · HH:MM` |
| 开启，插件消息 | 首行 `插件 (name)`，空格无影响 |
| 开启 + frontmatter | `message_count` 不变 |
| popup | 勾选后请求体带 `fenceMessages: true` |

## 验收

- 关闭时对同一会话导出结果与改动前逐字节相同
- 开启后的产物粘进 GitHub / Obsidian / VS Code 预览，均渲染为代码块、无语法破坏
- `pnpm typecheck && pnpm lint && pnpm test` 全绿，覆盖率 ≥ 90%
