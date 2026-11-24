---
title: 项目选择器与导出编排
id: task-007
parent: 24
issue: null
depends_on: [task-005, task-006]
assignee: backend
status: ready
---

# task-007: 项目选择器与导出编排

## 目标

弹窗新增项目下拉与会话过滤，支持「导出整个项目」，并把项目上下文一路传到产物层。依据 `docs/dev/specs/project-export.md` §4.2、§6。

## 范围

| 文件 | 操作 |
|---|---|
| `src/shared/messages.ts` | 新增 `RequestProjectListMessage`；`RequestConversationListMessage` 增加 `projectId` / `cursor`；`RequestExportConversationsMessage` 增加 `project`；`ConversationListResponse` 增加 `projects` / `cursor` |
| `src/shared/messages.test.ts` | 追加守卫用例 |
| `src/entrypoints/background.ts` | 路由 `REQUEST_PROJECT_LIST`，透传 `projectId` / `cursor` / `project` |
| `src/entrypoints/chatgpt.content/index.ts` | 处理项目列表请求；列表请求分流到 `fetchProjectConversations`；导出时把 `project` 传给 `MarkdownMetadata` 与图片前缀 |
| `src/entrypoints/chatgpt.content/index.test.ts` | 追加用例 |
| `src/entrypoints/popup/index.html` | 顶部新增项目下拉 |
| `src/entrypoints/popup/index.ts` | 项目加载、切换、清空选择、全选范围、导出按钮文案 |
| `src/entrypoints/popup/index.test.ts` | 追加用例 |
| `src/locales/en.json`、`zh_CN.json` | 新增项目相关文案 |

## 实现要点

1. 弹窗启动时并行取会话列表与项目列表；项目列表失败只影响下拉，不影响现有批量导出
2. 下拉首项「全部会话」；选中项目后列表改走 `projectId` + `cursor` 翻页（`offset` 不再适用）
3. 切换项目或切回「全部会话」→ 清空 `selectedIds` 并重新加载
4. 选中项目时导出按钮文案改为「导出整个项目（N 个会话）」，点击即「全选当前项目 + 导出」
5. 导出请求带 `project: { id, name }`；content 侧据此：
   - `buildProjectMarkdownFilename` / `buildProjectZipFilename`
   - `resolveImagesAsFileRefs(raw, entries, '<项目名>/')`
   - `conversationToMarkdown(..., { project })`
6. 项目与散会话**不混选**：项目模式下不显示非项目会话

## 测试

| 用例 | 断言 |
|---|---|
| 消息守卫 | 新类型正确识别；`project` / `projectId` 透传 |
| background 路由 | `REQUEST_PROJECT_LIST` 被转发到 content |
| 弹窗 | 下拉渲染项目；切换后请求带 `projectId`；全选只作用于当前项目；切回全部会话清空选择 |
| 导出编排 | 带 `project` 时产物进入项目目录、frontmatter 含项目字段、图片前缀为项目名 |
| 失败降级 | 项目列表请求失败时下拉只剩「全部会话」，批量导出仍可用 |

## 验收

- 真实账号：选项目 → 看到该项目的会话 → 「导出整个项目」得到符合 §5.1 的 ZIP
- 切回「全部会话」后，现有批量导出行为无变化
- `pnpm typecheck && pnpm lint && pnpm test` 全绿，覆盖率 ≥ 90%
