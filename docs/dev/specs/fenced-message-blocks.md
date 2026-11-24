# 技术方案：围栏消息块导出格式

- 状态：待实现
- 关联 PRD/issue： [#10](https://github.com/devcxl/chatgpt-markdown-exporter/issues/10)
- 关联 ADR：`docs/adr/2026-11-24-fenced-message-format.md`
- 调研：`research/fence-info-string` 分支的 `docs/research/fence-info-string-unicode.md`
- 原型：`prototype/fence-format` 分支（四种格式对照，选定 A）
- 涉及模块：`src/markdown/conversation-to-markdown.ts`、`src/entrypoints/popup/`、`src/shared/messages.ts`、`src/locales/*.json`

## 1. 目标

弹窗新增一个导出选项：把每条消息渲染成围栏代码块，取代当前的 `---` 分隔 + `## 角色` 标题。关闭时输出与现在**逐字节一致**。

## 2. 精确格式

开启后，每条消息：

```text
<围栏>
{角色名}[ · HH:MM]

{正文}
<围栏>
```

- `<围栏>` = N 个反引号 + `text`，N = 正文中最长连续反引号数 + 1（最小 3）
- 角色名来自 `t('markdown.authorUser' | 'markdown.authorChatGPT' | 'markdown.authorPlugin')`；插件消息为 `插件 (name)` 形式
- 时间戳仅在 `includeTimestamps` 为真时出现，格式沿用现有 `toLocaleTimeString`
- 首行与正文之间一个空行；消息块之间一个空行
- 不开该选项时：保持现有 `---` + `## 角色` + `> 时间` 结构

### 示例

````markdown
```text
用户 · 12:34

帮我看看这个函数为什么慢：

```ts
export function sum(xs: number[]) { … }
```
```
````

注意上面外层用了 4 个反引号——因为正文含 3 个。

## 3. 实现要点

### 3.1 `MarkdownOptions` 增加 `fenceMessages: boolean`

```ts
export type MarkdownOptions = {
  includeFrontmatter: boolean;
  includeTimestamps: boolean;
  timestamp24h: boolean;
  fenceMessages: boolean;
};
```

`renderMessageBlock(author, timestamp, body, options)`：

- `options.fenceMessages` 为假 → 现有拼接逻辑，一字不改
- 为真 → 计算围栏长度（`maxBacktickRun(body) + 1`，最小 3），按 §2 拼接

`messageCount` 的计数口径不变（仍是渲染出的块数）。

### 3.2 弹窗与 IPC

- `src/entrypoints/popup/index.html`：新增 `<input data-role="fence" type="checkbox" />`，文案 key `options.fenceMessages`
- `src/entrypoints/popup/index.ts`：读取该 checkbox，随 `REQUEST_EXPORT_CONVERSATIONS` 传递
- `src/shared/messages.ts`：`RequestExportConversationsMessage` 增加 `fenceMessages: boolean`
- `src/entrypoints/background.ts`：透传该字段
- `src/entrypoints/chatgpt.content/index.ts`：透传进 `MarkdownOptions`

### 3.3 i18n

`src/locales/en.json` / `zh_CN.json` 各新增一条：

| key | en | zh_CN |
|---|---|---|
| `options.fenceMessages` | Render each message as a fenced code block | 每条消息渲染为围栏代码块 |

点号在构建时展平为下划线，调用处写 `t('options.fenceMessages')`。

### 3.4 页内按钮不暴露该选项

`index.ts` 里页内导出仍写死 `{ includeFrontmatter: true, includeTimestamps: false, timestamp24h: true }`，本次追加 `fenceMessages: false`。页内按钮是否暴露格式选项属于「选项持久化」这个未定项，不在本次范围。

## 4. 统计口径

ADR-2026-07-31 D5 已定「不剥离 Markdown 语法标记」。开启围栏后：

- `word_count` 增加围栏标记与角色首行的词
- `line_count` 增加每条消息 2 行围栏 + 1 行角色

**接受该漂移，不改口径**。开启与关闭两种模式下，统计值都等于文件里实际出现的内容量。

## 5. 测试

`src/markdown/conversation-render.test.ts` 追加：

| 用例 | 断言 |
|---|---|
| 关闭选项 | 输出与现有一致（含 `---`、`## 角色`） |
| 开启，纯文本消息 | 外层 3 反引号 + `text`，首行为角色名 |
| 开启，正文含 ` ```ts ` | 外层 4 反引号，正文内围栏原样保留、不被截断 |
| 开启，正文含 4 连反引号 | 外层 5 反引号 |
| 开启 + 时间戳 | 首行为 `角色 · HH:MM` |
| 开启，插件消息 | 首行 `插件 (name)`，空格不影响围栏 |
| 开启，`includeFrontmatter` 同时为真 | frontmatter 正常，`message_count` 不变 |
| 关闭时 `fenceMessages` 缺省 | 走默认关，输出不变 |

`src/markdown/conversation-to-markdown.test.ts` 追加上面第 7 条。`src/entrypoints/popup/index.test.ts` 追加「勾选后消息体带 `fenceMessages: true`」。

## 6. 影响面

| 模块 | 影响 |
|---|---|
| `conversation-to-markdown.ts` | `MarkdownOptions` 必填字段增加 → 所有构造处必须补 `fenceMessages`（编译器会指出全部位置） |
| `messages.ts` | 消息类型增加字段，路由处需透传 |
| popup | 新增一个 checkbox 与 i18n 文案 |

## 7. 验收

- 关闭选项时，对同一会话导出的 `.md` 与改动前**逐字节相同**（用现有测试快照或手工 diff 验证）
- 开启后，把产物直接粘进 GitHub 评论框、Obsidian、VS Code 预览，三者都渲染为代码块且无语法破坏
- `pnpm typecheck && pnpm lint && pnpm test` 全绿，覆盖率 ≥ 90%
