# ADR：Export Stats in Markdown Frontmatter

- 日期：2026-07-31
- 状态：已接受
- 关联 PRD：`docs/prd/export-stats-in-frontmatter.md`
- 关联方案：`docs/dev/specs/export-stats-in-frontmatter.md`

## 背景

用户（长篇虚构小说作者）每天批量导出 ChatGPT 对话存档，希望在导出的 Markdown 顶部信息栏直接看到对话规模统计（字数/行数/消息条数），用于快速了解当天工作量与检索定位。PRD 要求在 frontmatter 区新增 `word_count`、`line_count`、`message_count` 三个字段，统计对象为导出正文（不含 frontmatter）。

## 决策

### D1：统计字段命名 — `word_count` / `line_count` / `message_count`

沿用 frontmatter 现有 snake_case 风格（`model_slug`、`create_time`、`exported_at`），与 PRD 指定字段名一致，保持 YAML 区命名体系统一。

### D2：word_count 口径 — 中文字符 + 英文单词分离求和

- 中文（`\p{Script=Han}`，含扩展区）逐字符计数；英文/数字按空白分词计数；两者相加。
- 剔除 CJK 标点（`\u3000-\u303F`、`\uFF00-\uFFEF`），否则「你好，世界」会把中文逗号误计为 1 个「单词」。
- 混合文本（如 `Hello世界`）按「汉字数 + 单词数」相加，满足「英文按单词、中文按字符」的核心约定。

**否决的替代方案：**

- 按语言整体切换（全中文字符数 / 全英文字符数）：无法处理混合文本，且纯英文按字符数会高估用户感知的字数。
- 引入分词库（如 `intl` 或第三方）：违反「不引入新依赖」约束，且中英混合场景收益有限。

### D3：统计对象为导出正文（normalize 之后，不含 frontmatter）

统计基于 `normalizeLineBreaks` 处理后的正文，而非渲染中间态。原因：`normalizeLineBreaks` 会折叠 4+ 连续换行，若统计在前，`line_count` 与文件实际行数不一致。为保证「统计值 = 用户看到的文件内容」，先 normalize 正文、再统计、再拼接 frontmatter。

### D4：message_count 以渲染管线实际输出块数为准

在渲染循环内计数（与 `shouldSkipMessage` 过滤及空 body 过滤同源），保证「数字 = 看到的条数」。

**与 PRD 表述的关系：** PRD 表格写「用户 + 助手消息，不含系统/工具消息」，但推荐口径写「与导出内容中实际出现的消息块数量一致」。两者在 tool 消息渲染出图像（`execution_output` 含 image）时冲突——该 tool 消息会渲染成消息块。本决策以推荐口径为准：渲染出的消息块即计入，系统消息与无图 tool 消息经 `shouldSkipMessage` 过滤后自然不计。

**否决的替代方案：** 事后用正则统计 `## ` 或 `---` 前缀数量。该方案与渲染逻辑脱钩，任何渲染格式调整都会静默破坏统计一致性。

### D5：不剥离 Markdown 语法标记

`---`、`## 作者名`、`>` 引用、代码围栏、URL 等直接计入统计。约束「不引入新依赖」下引入 Markdown 解析器不可接受；统计对象定义为「用户看到的正文文本」而非「净内容」。

### D6：includeFrontmatter: false 时零统计

统计计算（`countWords`/`countLines`）仅在 `includeFrontmatter` 分支内执行，关闭 frontmatter 时输出与改动前逐字节一致，行为不变。

## 后果

- 正面：三字段与导出内容严格自洽（数字 = 看到的条数/行数）；零新依赖；`includeFrontmatter: false` 与现有导出行为完全不受影响。
- 代价：`word_count` 含 Markdown 语法标记（每消息块约 +2~3 个单词），非「净字数」口径；若用户后续期望净字数，需另立需求。
- 风险：`\p{Script=Han}` 依赖 ES2018+ 运行时（WXT 编译产物目标满足，无实际风险）。
