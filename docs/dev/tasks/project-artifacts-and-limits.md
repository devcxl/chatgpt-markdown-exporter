---
title: 项目产物命名、上限与 frontmatter
id: task-006
parent: 24
issue: null
depends_on: [task-005]
assignee: backend
status: ready
---

# task-006: 项目产物命名、上限与 frontmatter

## 目标

让产物能按项目分目录、带上项目元数据，并把 ZIP 文件数上限从 100 提到 500。依据 `docs/dev/specs/project-export.md` §5。

## 范围

| 文件 | 操作 |
|---|---|
| `src/shared/files.ts` | 新增 `buildProjectMarkdownFilename`、`buildProjectZipFilename` |
| `src/shared/files.test.ts` | 追加用例 |
| `src/markdown/conversation-to-markdown.ts` | `MarkdownMetadata` 增加 `project?: { id, name }`，frontmatter 输出两行 |
| `src/markdown/conversation-to-markdown.test.ts` | 追加用例 |
| `src/entrypoints/background.ts` | `MAX_ZIP_FILES` 100 → 500；超字节上限文案调整 |

## 实现要点

1. `buildProjectMarkdownFilename(project, title, chatId, date)` → `<项目名>/<YYYY-MM-DD>-<标题>.md`；项目名与标题都过 `sanitize-filename`，项目名为空回退项目 id（接收 `Project = { id, name }`；只传 name 无法回退）
2. `buildProjectZipFilename(project, date)` → `chatgpt-project-<项目名>-<stamp>.zip`
3. 现有 `buildMarkdownFilename` / `buildZipFilename` **不改**（普通批量导出继续用）
4. frontmatter：仅当 `metadata.project` 存在时输出
   ```yaml
   project: "..."
   project_id: "..."
   ```
   位置放在 `source` 之后、`model` 之前；非项目导出不出现，保证现有输出逐字节不变
5. `MAX_ZIP_FILES = 500`；`MAX_ZIP_TOTAL_BYTES` 保持 12MB；超限**沿用**现有 `background.contentTooLarge`（该文案对普通批量与项目导出都成立，不为项目单独加分支 —— 以 spec §5.2 为准）

## 测试

| 用例 | 断言 |
|---|---|
| 项目文件名 | `<项目名>/2026-11-24-标题.md` |
| 非法字符 | 标题与项目名中的 `/`、`:` 等被清理，仍保持一层目录 |
| 空项目名 | 回退项目 id |
| 同项目同名标题 | `dedupeNamedFiles` 产出 `(2)` |
| ZIP 名 | `chatgpt-project-<项目名>-<stamp>.zip` |
| frontmatter 有项目 | 含 `project` / `project_id` 两行且转义正确 |
| frontmatter 无项目 | 不出现这两行（与旧输出逐字节一致） |
| 上限 | 500 个文件放行、501 个报错 |

## 验收

- 非项目导出路径的产物与改动前完全一致
- `pnpm typecheck && pnpm lint && pnpm test` 全绿，覆盖率 ≥ 90%
