# 技术方案：Markdown Frontmatter 导出统计信息

- 状态：待实现
- 关联 PRD：`docs/prd/export-stats-in-frontmatter.md`
- 关联 ADR：`docs/adr/2026-07-31-export-stats-frontmatter.md`
- 涉及模块：`src/markdown/conversation-to-markdown.ts`

## 1. 目标

在导出的 Markdown frontmatter 区新增三个统计字段 `word_count`、`line_count`、`message_count`，统计对象为**导出正文**（不含 frontmatter 本身）。

约束：

- `includeFrontmatter: false` 时行为完全不变（统计逻辑零执行）
- 现有导出功能（批量 ZIP、文件名、内容格式）行为不变
- 不引入新依赖、不新增抽象层

## 2. 统计口径精确定义

### 2.1 统计对象

统计对象为**最终导出文件中 frontmatter 之后的正文字符串**（即 `normalizeLineBreaks` 处理之后的 content，不含 `# title` 行）。

> 实现注意：现有代码在返回语句中对「frontmatter + title + content」整体执行 `normalizeLineBreaks`。`normalizeLineBreaks` 会将 `\n{4,}` 折叠为 `\n\n\n`，若统计在 normalize 之前计算，`line_count` 会与文件实际行数不一致（最多差 1 行/消息块）。因此**先对 content 单独 normalize，再统计，最后拼接**。frontmatter 与 title 行不会产生 4+ 连续换行（`yamlString` 已转义），不受影响，行为等价。

### 2.2 word_count（混合中英文计数）

**算法（纯函数，无正则回溯问题）：**

```
hanCount   = text 中 \p{Script=Han} 字符的数量
nonHanText = text 剔除所有 Han 字符，并将 CJK 标点（\u3000-\u303F、\uFF00-\uFFEF）替换为空格
wordCount  = nonHanText 按 /\s+/ 分割后的非空段数量
word_count = hanCount + wordCount
```

**规则表：**

| 场景 | 示例 | 结果 | 说明 |
|---|---|---|---|
| 纯英文 | `Hello world` | 2 | 空白分割 |
| 英文+英文标点 | `Hello, world!` | 2 | 标点附着在单词上，不单独计数 |
| 纯中文 | `你好世界` | 4 | 每汉字 1 字 |
| 中文+中文标点 | `你好，世界！` | 4 | 中文标点不计（剔除后不产生"单词"） |
| 混合无空格 | `Hello世界` | 3 | 1 单词 + 2 汉字 |
| 混合中文逗号 | `好的，let me check` | 5 | 2 汉字 + 3 单词 |
| 数字 | `123 456` | 2 | 数字序列按英文单词规则 |
| URL | `Visit https://example.com now` | 3 | 无空格的连续串计 1 个单词 |
| 代码块 | `` `const x = 1;` `` | 3 | 代码内容计入，不做剥离 |
| 空串 / 纯空白 | `""` / `"   "` | 0 | — |

**明确不做的处理（记录在案）：**

- **不解析 Markdown 语法**：`---`、`## 作者名`、`> 引用`、代码围栏等标记直接计入统计（`---` 计 1 个单词，`## ChatGPT` 计 1 个单词）。这是「不引入 Markdown 解析器」约束下的必然取舍，且与「统计对象 = 用户看到的正文文本」直觉一致。
- **不剥离代码块 / URL**：无空格连续串一律按 1 个单词计。
- 中文判定使用 Unicode 属性 `\p{Script=Han}`（含扩展区汉字），TS 5.5 / WXT 默认 target 支持，无需引入字表。

### 2.3 line_count

```
countLines(text) = text.trim() 为空 ? 0 : text.trim().split('\n').length
```

**规则表：**

| 输入 | 结果 |
|---|---|
| `""` | 0 |
| `"single line"` | 1 |
| `"a\nb"` | 2 |
| `"a\n\nb"`（消息块间空行） | 3（中间空行是真实存在的行） |
| `"a\n\n"`（尾部格式空行） | 1（trim 剔除尾部空行） |

### 2.4 message_count

**口径：渲染管线中实际输出消息块的数量**，即满足以下全部条件的节点数：

1. `node.message` 存在且有 `content`
2. `shouldSkipMessage(message)` 返回 `false`
3. `transformContent(message)` 结果 `trim()` 后非空（如空的 `tether_browsing_display` 会被过滤）

**与 PRD 表述的关系：**

- PRD 表格写「用户 + 助手消息，不含系统/工具消息」，推荐口径写「与导出内容中实际出现的消息块数量一致，保证数字 = 看到的条数」。两者在 tool 消息渲染出图像（`execution_output` 含 image 的 `aggregate_result`）时冲突——该 tool 消息**会**渲染成消息块。
- 本方案以「实际渲染块数」为准（PRD 推荐口径）：`message_count` 恒等于导出文件中 `---` 消息块数量。系统消息（recipient 非 `all`）与无图 tool 消息经 `shouldSkipMessage` 过滤后不计入。

**实现方式：** 在渲染循环内计数（`messageCount += 1`），**禁止**事后用正则数 `## ` 前缀或 `---` 分隔符——后者脆弱且与渲染逻辑脱钩。

## 3. 代码改动设计

### 3.1 新增 `src/markdown/stats.ts`（纯函数模块）

```ts
/** 统计正文字数：中文字符数 + 英文/数字单词数，中文标点不计 */
export function countWords(text: string): number;

/** 统计正文行数：按 \n 分割，剔除首尾空行 */
export function countLines(text: string): number;
```

两个函数均为无副作用纯函数，只依赖字符串，可独立单测。**不新增任何抽象层。**

### 3.2 修改 `src/markdown/conversation-to-markdown.ts`

**改动 1：提取渲染循环为 `renderContent`**

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

`shouldSkipMessage`、`transformContent`、`renderMessageBlock` 等函数**原样不动**。

**改动 2：主函数调整构建顺序**

```ts
export function conversationToMarkdown(...): string {
  const source = ...;                       // 不变
  const exportedAt = ...;                   // 不变
  const { content, messageCount } = renderContent(conversation, options);
  const normalizedContent = normalizeLineBreaks(content);  // 统计对象 = 最终行结构

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
}
```

- `includeFrontmatter: false` 时：`renderContent` 仍执行（渲染必经路径），但 `countWords`/`countLines` 只在 `includeFrontmatter` 分支内调用、`messageCount` 只在分支内使用，统计逻辑零开销、输出逐字节不变。TS `noUnusedLocals` 不会误报（三者在分支内均被引用）。
- 字段命名沿用现有 YAML snake_case 风格（`model_slug`、`create_time`），与 PRD 指定字段名一致。
- **不需要 i18n 变更**：三个字段是 YAML key，无用户可见文案。

### 3.3 不改动的部分

- `src/shared/chatgpt-types.ts`：无需新增类型（统计为纯字符串运算 + 局部计数）
- `src/i18n/locales.ts`：无需新增文案
- 消息协议 / background / content script：零改动

## 4. 测试策略

沿用现有 Vitest 模式（参考 `src/shared/zip-core.test.ts`：与被测模块同目录、同名 `.test.ts`、`describe/it/expect`）。

### 4.1 新增 `src/markdown/stats.test.ts`（纯函数单测）

`countWords`：

- 纯英文 `Hello world` → 2
- 纯中文 `你好世界` → 4；带中文标点 `你好，世界！` → 4
- 混合 `Hello世界` → 3；`好的，let me check` → 5
- 英文标点 `Hello, world!` → 2
- 数字 `123 456` → 2；URL `Visit https://example.com now` → 3
- 代码块内容 `const x = 1;` → 3
- 空串 / 纯空白 → 0

`countLines`：

- `""` → 0；`"a"` → 1；`"a\nb"` → 2；`"a\n\nb"` → 3；`"a\n\n"` → 1

### 4.2 新增 `src/markdown/conversation-to-markdown.test.ts`（集成测试）

构造最小 `ConversationResult` fixture（user / assistant / system / tool 各一条）：

- frontmatter 含三个新字段，且 `word_count`/`line_count` 与正文实际值一致
- `message_count` = 渲染出的消息块数（`---` 块数），system 消息不计
- tool 带图消息（`execution_output` + `aggregate_result` 含 image）计入
- 空 body 消息（空 `tether_browsing_display`）不计
- `includeFrontmatter: false` → 输出不含三个字段，且输出与改动前完全一致

## 5. 影响面与风险

| 项目 | 评估 |
|---|---|
| 行为变更 | 仅 frontmatter 多三行；`includeFrontmatter: false` 输出逐字节不变 |
| 性能 | 单会话文本量级，正则线性扫描，无感知 |
| 依赖 | 无新增 |
| 兼容性 | `\p{Script=Han}` 需 ES2018+（TS 5.5 / WXT 默认 target 满足）；Firefox MV2 环境为 WXT 编译产物，无额外要求 |

## 6. 假设与不确定项

1. **Markdown 语法标记计入统计**（`---`、`##`、`>` 等各计为单词）。若后续用户反馈期望「净字数」，需引入解析器或剥离逻辑，属独立需求。
2. **URL 计 1 个单词**（无空格连续串）。极端情况如 markdown 链接 `[text](url)` 中的 `text` 与 `url` 各计 1 个单词。
3. **message_count 以实际渲染块数为准**，tool 带图消息计入。若产品上明确要求「只数 user+assistant」，需同步改变渲染行为（当前 tool 带图消息会渲染出消息块），超出本需求范围。
4. 统计字段仅在 `includeFrontmatter` 为 true 时写入，用户无法单独关闭统计（PRD 未要求）。

## 7. 交付物清单

| 文件 | 操作 |
|---|---|
| `src/markdown/stats.ts` | 新增 |
| `src/markdown/stats.test.ts` | 新增 |
| `src/markdown/conversation-to-markdown.test.ts` | 新增 |
| `src/markdown/conversation-to-markdown.ts` | 修改（renderContent 提取 + frontmatter 三字段） |

验证命令：`pnpm typecheck` && `pnpm lint` && `pnpm test` && `pnpm build`
