# ADR：围栏消息块的语言标识固定为 `text`

- 日期：2026-11-24
- 状态：已接受
- 关联 issue： [#30](https://github.com/devcxl/chatgpt-markdown-exporter/issues/30)、[#27](https://github.com/devcxl/chatgpt-markdown-exporter/issues/27)、[#10](https://github.com/devcxl/chatgpt-markdown-exporter/issues/10)
- 关联方案：`docs/dev/specs/fenced-message-blocks.md`
- 调研：`research/fence-info-string` 分支的 `docs/research/fence-info-string-unicode.md`

## 背景

#10 要求提供「把每条消息渲染成围栏代码块」的导出选项，并明确写「围栏语言标识用角色名 `User` / `ChatGPT` / `Plugin`，且必须复用 `src/locales/*.json` 的 `markdown.authorUser` / `authorChatGPT` / `authorPlugin`，不硬编码」。

中文界面下这三个值是 `用户` / `ChatGPT` / `插件`。因此「复用 locales」与「语言标识用角色名」两条要求合起来意味着 fence info string 会是中文。

实测（2026-11-24，含 CommonMark 规范条款与各渲染器源码/实测）结论：

- **语法上合法**：CommonMark §4.5 只禁止反引号；规范自身 Example 34 就产出 `class="language-föö"`
- **生态上不安全**：
  - highlight.js 的 `languageDetectRe = /\blang(?:uage)?-([\w-]+)\b/i` 中 `\w` 不含 CJK → `language-用户` 匹配不上 → 落回 `highlightAuto()`，正文被**误染成随机语言**（实测 `language-用户` → `language-abnf`）。而 ASCII 未知语言会干净回落到 `no-highlight`
  - 未做 guard 的 hljs 集成可能 `throw Unknown language`，可放大成整篇渲染失败
  - Python-Markdown 的 `fenced_code`（MkDocs 默认启用）与 `pymdownx.superfences` 默认配置，遇到**带空格**的 info string 会把整块降级成段落 + 行内 `<code>`。`Plugin (name)` 天然带空格，100% 踩中（与中文无关，ASCII 的 `js v1` 同样坏）

## 决策

### D1：info string 取字面量 `text`

不本地化、不随 locale 变、不携带角色信息。

选 `text` 而非其他 ASCII 值的原因：hljs / Prism / Shiki 都注册了 Plain text，既不抛错也不触发自动侦测；`markdown` 会让块内内容被当 Markdown 处理（与"代码块"语义相反）；`User` / `ChatGPT` 属于未知语言，在部分高亮器里仍会触发自动侦测与告警。

### D2：本地化角色名与时间移到围栏内首行

`#10` 的「复用 locales」要求通过位置调整保留：角色名仍然来自 `t('markdown.authorUser')` 等，只是从 info string 移到块内第一行。这样既满足「不硬编码」，也不再受 info string 的字符与空格限制。

### D3：围栏长度自适应

外层反引号数量 = 正文中最长连续反引号数 + 1，最小 3。消息正文里的 ` ```ts ` 因此不会被提前闭合。不用四反引号固定：会给所有块增加无意义的视觉噪音。

### D4：默认关闭

导出结果不因升级静默变形。开启后 `---` 与 `## 角色` 一并移除（这是该选项的意义）。

### D5：不改统计口径

ADR-2026-07-31 D5 已定「不剥离 Markdown 语法标记」。开围栏后 `word_count` / `line_count` 会变，这与「统计 = 文件里看到的文本」一致，因此不新增口径分支，只在 spec 里记录这一已知漂移。

**否决的替代方案：为围栏模式单独计算净字数。** 会引入两套口径，且与 D5 冲突。

## 后果

- 正面：产物在 GitHub / Obsidian / VS Code / Typora / pandoc / Hugo 下都稳定；不会因高亮器行为产生"随机染色"这类难以排查的副作用
- 负面：块首的 `text` 标识与 AMO 用户原意（「用 User 作为语言标识」）不完全一致；角色语义改由块内首行承担
- 已知代价：围栏内的图片 `![](...)`、网页引用、脚注不会渲染，会以纯文本出现。这是「把消息当代码块」的必然结果，提出该需求的用户本人也是手工转成围栏后使用
