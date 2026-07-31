## 技术方案 + ADR：Frontmatter 导出统计信息

### 技术方案
[docs/dev/specs/export-stats-in-frontmatter.md](https://github.com/devcxl/chatgpt-markdown-exporter/blob/master/docs/dev/specs/export-stats-in-frontmatter.md)

### ADR
[docs/adr/2026-07-31-export-stats-frontmatter.md](https://github.com/devcxl/chatgpt-markdown-exporter/blob/master/docs/adr/2026-07-31-export-stats-frontmatter.md)

### 方案摘要

**统计口径**

- `word_count`：`\p{Script=Han}` 汉字逐字符计数 + 剔除 CJK 标点后按空白分词计英文/数字单词，两者相加（`Hello世界` → 3）。中文标点不计（`你好，世界！` → 4）。
- `line_count`：正文按 `\n` 分割的物理行数，剔除首尾格式空行；统计对象为 `normalizeLineBreaks` 之后的正文，保证与文件实际行数一致。
- `message_count`：渲染管线中实际输出的消息块数（与 `shouldSkipMessage` + 空 body 过滤同源计数，非事后正则统计），保证「数字 = 看到的条数」。tool 带图消息会渲染故计入（PRD 推荐口径优先于表格口径，详见 ADR D4）。
- 不剥离 Markdown 语法（`---`/`##`/URL/代码块计入），无新依赖。

**改动点（4 个文件，2 新增 2 修改）**

1. 新增 `src/markdown/stats.ts`：纯函数 `countWords` / `countLines`
2. 新增 `src/markdown/stats.test.ts`：纯函数单测（中英混合、标点、URL、数字、代码块、空串）
3. 新增 `src/markdown/conversation-to-markdown.test.ts`：集成测试（三字段值、message_count 与渲染块数一致、system/tool 过滤、`includeFrontmatter: false` 输出不变）
4. 修改 `src/markdown/conversation-to-markdown.ts`：提取 `renderContent`（返回 content + messageCount），frontmatter 追加三字段；`includeFrontmatter: false` 时统计零执行

**关键设计决策**

1. 字段命名沿用 YAML snake_case（与 `model_slug` 等一致）
2. 中文按字符、英文按单词，混合分离求和
3. 统计对象为 normalize 后的正文（非 frontmatter），先 normalize 再统计避免行数偏差
4. `message_count` 以渲染管线计数为准，保证数字与导出内容自洽
5. 不解析 Markdown 语法、不引入依赖

**验证**：`pnpm typecheck` && `pnpm lint` && `pnpm test` && `pnpm build`
