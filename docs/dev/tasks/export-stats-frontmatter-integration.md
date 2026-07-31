---
title: 渲染管线统计集成（frontmatter 三字段）
id: task-002
parent: 1
issue: 3
depends_on: [task-001]
assignee: backend
status: ready
---

# task-002: 渲染管线统计集成（frontmatter 三字段）

## 目标

修改 `src/markdown/conversation-to-markdown.ts`：提取渲染循环为 `renderContent`（返回 `{ content, messageCount }`），并在 frontmatter 区新增 `word_count`、`line_count`、`message_count` 三个字段，配套集成测试。依赖 task-001 的 `countWords`/`countLines`。

## 范围

| 文件 | 操作 |
|---|---|
| `src/markdown/conversation-to-markdown.ts` | 修改 |
| `src/markdown/conversation-to-markdown.test.ts` | 新增 |

`shouldSkipMessage`、`transformContent`、`renderMessageBlock` 等函数**原样不动**。

## 实现要点（依据技术方案 §2.1、§2.4、§3.2）

### 改动 1：提取 renderContent

```ts
function renderContent(
  conversation: ConversationResult,
  options: MarkdownOptions,
): { content: string; messageCount: number } {
  let messageCount = 0;
  const blocks = conversation.conversationNodes
    .map((node) => {
      // 现有过滤/渲染逻辑不变，唯一新增：渲染前 messageCount += 1
    })
    .filter(Boolean);
  return { content: blocks.join('\n\n'), messageCount };
}
```

**message_count 口径：渲染管线中实际输出消息块的数量**。在渲染循环内计数（`messageCount += 1`），禁止事后用正则数 `## ` / `---`。满足全部条件的节点计入：

1. `node.message` 存在且有 `content`
2. `shouldSkipMessage(message)` 返回 `false`
3. `transformContent(message)` 结果 `trim()` 后非空（如空的 `tether_browsing_display` 被过滤）

tool 带图消息（`execution_output` 含 image 的 `aggregate_result`）会渲染成消息块，**计入**；系统消息（recipient 非 `all`）与无图 tool 消息经 `shouldSkipMessage` 过滤，**不计**。

### 改动 2：主函数构建顺序（统计对象 = normalize 后的正文）

```ts
const { content, messageCount } = renderContent(conversation, options);
const normalizedContent = normalizeLineBreaks(content);  // 先 normalize，再统计

const frontmatter = options.includeFrontmatter
  ? [
      '---',
      // ...现有字段不变，
      `word_count: ${countWords(normalizedContent)}`,
      `line_count: ${countLines(normalizedContent)}`,
      `message_count: ${messageCount}`,
      '---',
      '',
    ].join('\n')
  : '';

return `${frontmatter}# ${conversation.title}\n\n${normalizedContent}\n`;
```

关键约束：

- **先对 content 单独 normalize，再统计，最后拼接**（不能对整体结果统计后再拼接：normalize 会把 `\n{4,}` 折叠为 `\n\n\n`，统计在 normalize 之前会导致 `line_count` 与文件实际行数不一致，最多差 1 行/消息块）
- `includeFrontmatter: false` 时：`renderContent` 仍执行（渲染必经路径），但 `countWords`/`countLines` 只在分支内调用、`messageCount` 只在分支内使用 → 统计逻辑零执行、输出逐字节不变；三者在分支内均被引用，`noUnusedLocals` 不会误报
- 字段名沿用现有 YAML snake_case（`word_count`/`line_count`/`message_count`），无 i18n 变更
- 返回语句最外层不再对整体执行 `normalizeLineBreaks`（已对 content 单独处理；frontmatter 与 title 行不会产生 4+ 连续换行，行为等价）

## 测试用例（conversation-to-markdown.test.ts）

构造最小 `ConversationResult` fixture（user / assistant / system / tool 各一条），测试：

1. frontmatter 含三个新字段，且 `word_count`/`line_count` 与正文实际值一致
2. `message_count` = 渲染出的消息块数（`---` 块数），system 消息不计
3. tool 带图消息（`execution_output` + `aggregate_result` 含 image）计入
4. 空 body 消息（空 `tether_browsing_display`）不计
5. `includeFrontmatter: false` → 输出不含三个字段，且输出与改动前完全一致（逐字节对比）

> fixture 需注意 `transformContent` 对 assistant 消息会处理 citations/content_references/math，最小 fixture 的 metadata 置空即可。`buildTimestamp` 依赖 `create_time`，测试 options 可设 `includeTimestamps: false` 简化断言。

## 验收要点

1. `pnpm typecheck` 通过（`noUnusedLocals`/`noUnusedParameters` 无报错）
2. `pnpm lint` 通过
3. `pnpm test` 全绿（含新增 conversation-to-markdown.test.ts，且不破坏 stats.test.ts）
4. `pnpm build` 成功
5. `includeFrontmatter: false` 输出与改动前逐字节一致（有测试覆盖）
6. `message_count` 恒等于导出文件中 `---` 消息块数量（与渲染逻辑同源）
