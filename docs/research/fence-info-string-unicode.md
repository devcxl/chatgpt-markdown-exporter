# 围栏 info string 能否用中文角色名？

> Issue: [devcxl/chatgpt-markdown-exporter#27](https://github.com/devcxl/chatgpt-markdown-exporter/issues/27)
> 研究日期：2026-11-24
> **结论一句话**：CommonMark / GFM 规范本身不禁止中文 info string，用 `用户` 作 info string 不会破坏语法；但它是「未知语言」，所有主流渲染器都不会高亮；且带空格的角色名（`Plugin (name)`）在 Python-Markdown 系（MkDocs）会直接破坏围栏。因此 `t('markdown.authorUser')` **可以**安全地用作 fence info string，但**不建议**——应当用固定 ASCII 语言标识，把角色名放到块内第一行。

## 目录

1. [结论表](#1-结论表)
2. [规范原文：CommonMark 与 GFM 对 info string 的约束](#2-规范原文commonmark-与-gfm-对-info-string-的约束)
3. [GitHub 实际渲染行为（实测）](#3-github-实际渲染行为实测)
4. [主流渲染器实测矩阵](#4-主流渲染器实测矩阵)
5. [info string 里带空格是否合法（`Plugin (name)`）](#5-info-string-里带空格是否合法plugin-name)
6. [结论与替代方案](#6-结论与替代方案)
7. [附录 A：实测环境与脚本](#附录-a实测环境与脚本)
8. [附录 B：参考来源](#附录-b参考来源)

---

## 1. 结论表

| 渲染器 / 引擎 | 以 `用户` 作 info string 的行为 | 依据 |
|---|---|---|
| **CommonMark 规范** | 合法。info string 只禁止反引号（backtick fence）与换行；中文是普通字符 | CommonMark 0.31.2 §4.5 原文 + cmark-gfm `scanners.re` 中反引号围栏的字符集 ``[^`\r\n\x00]*`` |
| **cmark-gfm（GitHub 引擎）0.29.0.gfm.13** | 正常渲成代码块，`class="language-用户"`；GitHub 配置下变成 `<pre lang="用户">`，不高亮 | 本机 `cmark-gfm` 实测 |
| **GitHub 网页 / API（GFM）** | 正常代码块，无高亮，**不破坏语法** | `POST https://api.github.com/markdown` 实测返回 `<pre lang="用户" class="notranslate">` |
| **Obsidian 1.15.1**（阅读视图） | 正常代码块，无高亮；Prism 拿不到语法，额外追加 `language-none` 类（原 `language-用户` 保留，无视觉破坏） | 从 `obsidian.asar` 提取的 `app.js` 渲染函数 + 随包 Prism 1.30.0 实测 |
| **Typora 1.14.9** | 围栏能被识别（正则接受任意非反引号字符），语言 token 查不到 CodeMirror mode → 不高亮 | `resources/appsrc/window/frame.js` 的围栏正则实测（**GUI 未跑，见 §4.4 说明**） |
| **VS Code 1.147.0 内置预览** | 正常代码块，无高亮（`hljs.getLanguage('用户')` 为 undefined → 走 `escapeHtml` 兜底） | 本机 `markdown-language-features/dist/extension.js` 源码 + 复刻逻辑实测 |
| **markdown-it 15 / marked 18 / commonmark.js 0.31 / remark+rehype** | 全部正常代码块，`class="language-用户"` | 本机实测 |
| **Python-Markdown 3.11（MkDocs 默认 `fenced_code`）** | 单 token 中文正常（`class="language-用户"`）；**带空格则整个围栏失效**，退化成行内代码段落 | 本机实测 |
| **pymdownx.superfences 13.1.2** | 中文正常但不产出 `language-*` 类；**带空格同样失效** | 本机实测 |
| **pandoc 3.14** | 正常代码块，`class="用户"`（不是 `language-用户`），不高亮 | 本机实测 |
| **Hugo 0.167（goldmark）** | 正常代码块，`class="language-用户" data-lang="用户"`，不高亮 | 本机实测 |
| **Notion 导入** | **未确认**（无法用账号实测；其 API 的 `language` 字段是封闭枚举，含 `"plain text"` 兜底，推测会落到 Plain text） | Notion API `LanguageRequest` 类型定义 |

关键区分：

- **语法安全性**：中文 info string 在所有遵循 CommonMark/GFM 的解析器里都**不会**破坏围栏——它只是一个「未知语言」。
- **语义价值**：没有任何渲染器会因为收到 `用户` 而给块加视觉区分；它既不高亮，也不会在 GitHub/Obsidian/VS Code 里显示成人能看见的标签。
- **踩雷点**：**带空格**的 info string（`Plugin (name)`）在 CommonMark/GFM 里合法，但 Python-Markdown 家族（MkDocs、python-markdown 的 `fenced_code`、`pymdownx.superfences` 默认配置）会把整块降级成普通段落 + 行内 `<code>`。这跟中文无关，ASCII 的 `js v1` 一样会坏。

---

## 2. 规范原文：CommonMark 与 GFM 对 info string 的约束

### 2.1 CommonMark 0.31.2 §4.5 Fenced code blocks

> The line with the opening code fence may optionally contain some text
> following the code fence; this is trimmed of leading and trailing
> spaces or tabs and called the **info string**. If the info string comes
> after a backtick fence, it **may not contain any backtick characters**.
> (The reason for this restriction is that otherwise some inline code would
> be incorrectly interpreted as the beginning of a fenced code block.)

以及：

> The content of a code fence is treated as literal text, not parsed as inlines.
> **The first word of the info string is typically used to specify the language
> of the code sample**, and rendered in the class attribute of the code tag.
> **However, this spec does not mandate any particular treatment of the info string.**

同节后文（HTML 输出约定）：

> An info string can be provided after the opening code fence. Although this
> spec doesn't mandate any particular treatment of the info string, the first
> word is typically used to specify the language of the code block. In HTML
> output, the language is normally indicated by adding a class to the `code`
> element consisting of `language-` followed by the language name.

**要点**：

1. 规范对 info string 的**唯一硬约束**是「反引号围栏的 info string 不得含反引号」（Example 145），以及它不能跨行（info string 只到行尾）。
2. 规范用词是 **"first word"**——第一个词 = 语言名。第一个词之后的内容（空格分隔）**规范不处理**，属于实现自由（GitHub 塞进 `data-meta`，remark 塞进 `node.meta`，markdown-it 作为 `langAttrs` 传给 highlight 回调）。
3. 规范**没有任何 ASCII 限制**。规范自己就有一个非 ASCII 的实例（§2.5 Example 34）：

````markdown
``` f&ouml;&ouml;
foo
```
````

> → `<pre><code class="language-föö">foo</code></pre>`

`f&ouml;&ouml;` 解码后是 `föö`，直接进了 `class`。这说明规范层面 info string 是**按字符（Unicode code point）**处理的（§2.1：「A character is a Unicode code point」），非 ASCII 完全合法。

规范里另一个关键实例（Example 144）说明「任意标点也可以」：

`````markdown
````;
````
`````

> → `<pre><code class="language-;"></code></pre>`

### 2.2 参考实现 cmark-gfm 的扫描器（语法层面的权威证据）

`src/scanners.re`（GitHub 的 C 实现，`cmark-gfm` 0.29.0.gfm.13）：

```re2c
// Scan an opening code fence.
bufsize_t _scan_open_code_fence(const unsigned char *p)
{
/*!re2c
  [`]{3,} / [^`\r\n\x00]*[\r\n] { return (bufsize_t)(p - start); }
  [~]{3,} / [^\r\n\x00]*[\r\n] { return (bufsize_t)(p - start); }
  * { return 0; }
*/
}
```

- 反引号围栏之后允许的字节集：`` [^`\r\n\x00]* `` —— 除了**反引号、CR、LF、NUL** 之外的一切字节。
- 波浪号围栏：`[^\r\n\x00]*` —— 连反引号都允许（对应 CommonMark Example 146：`~~~ aa ``` ~~~` → `language-aa`）。
- 换句话说：**UTF-8 的中文字节 `E7 94 A8 E6 88 B7` 完全在允许集内**。解析器不会、也不需要做任何 ASCII 校验。

info string 的提取与裁剪（`src/blocks.c`，`CMARK_NODE_CODE_BLOCK` 收尾分支）：

```c
// first line of contents becomes info
cmark_strbuf tmp = CMARK_BUF_INIT(parser->mem);
houdini_unescape_html_f(&tmp, node_content->ptr, pos);   // 解 HTML 实体（&ouml; → ö）
cmark_strbuf_trim(&tmp);                                  // 只裁 ASCII 空白
cmark_strbuf_unescape(&tmp);                              // 解反斜杠转义
b->as.code.info = cmark_chunk_buf_detach(&tmp);
```

`cmark_strbuf_trim` 用 `cmark_isspace()`，而它基于 `cmark_ctype_class[256]` 表，**只认 ASCII 空白**（`\t \n \f \r` 与空格）。所以：

- 中文不会被任何 trim/转义逻辑影响；
- 全角空格 U+3000 **不算**空白（见 §5.3 的实测差异）。

「第一个词」怎么切（`src/html.c`，`CMARK_NODE_CODE_BLOCK`）：

```c
bufsize_t first_tag = 0;
while (first_tag < node->as.code.info.len &&
       !cmark_isspace(node->as.code.info.data[first_tag])) {
  first_tag += 1;
}
```

按 `cmark_isspace`（ASCII 空白）切第一个词 → `用户`、`Plugin` 都是完整的一个词。

### 2.3 GFM 规范 §4.5

GFM 规范（<https://github.github.com/gfm/#fenced-code-blocks>）与 CommonMark 同节文本基本一致，只有措辞差异：

> The line with the opening code fence may optionally contain some text following
> the code fence; this is trimmed of leading and trailing **whitespace** and called
> the **info string**. If the info string comes after a backtick fence, it **may not
> contain any backtick characters**.

> The first word of the info string is typically used to specify the language of
> the code sample, and rendered in the class attribute of the code tag. **However,
> this spec does not mandate any particular treatment of the info string.**

GFM 规范里同样保留着那个 `föö` 的非 ASCII 实例（`Entity and numeric character references are recognized in any context ... including ... [fenced code block][] [info strings]`），输出 `<pre><code class="language-föö">`。

**GFM 没有在 CommonMark 之上给 info string 增加任何字符限制。**

---

## 3. GitHub 实际渲染行为（实测）

### 3.1 GitHub 官方 Markdown 渲染 API

`POST https://api.github.com/markdown`（`mode: "gfm"`，与网页评论/README 同一套渲染管线）：

```bash
gh api /markdown -f mode=gfm -f text='```用户
你好
```'
```

实测输出（2026-11-24）：

```html
<pre lang="用户" class="notranslate"><code class="notranslate">你好
</code></pre>
```

对比已知语言：

```html
<div class="highlight highlight-source-js"><pre class="notranslate"><span class="pl-s1">x</span></pre></div>
```

结论：

- **语法没有破坏**——仍然是一个 `<pre><code>` 代码块，只是**没有 `highlight` 外壳、没有高亮 token**。
- GitHub 走的是 `CMARK_OPT_GITHUB_PRE_LANG` + `CMARK_OPT_FULL_INFO_STRING` 配置，所以语言名落在 `lang=` 属性而不是 `class="language-..."`：

```html
<pre lang="用户" data-meta="v1"><code>z
</code></pre>
<pre lang="Plugin" data-meta="(name)"><code>x
</code></pre>
```

- `data-meta` 里的内容（`v1`、`(name)`）在 GitHub 网页上**不可见**，只是 HTML 属性。
- 未知语言**不会**触发 GitHub 的「报错/降级成段落」；GFM 的兜底就是「不加高亮类」。

### 3.2 本机 cmark-gfm（GitHub 引擎）

```bash
$ cmark-gfm m.md
<pre><code class="language-用户">你好
</code></pre>
<pre><code class="language-用户">z
</code></pre>
<pre><code class="language-Plugin">x
</code></pre>
<pre><code class="language-js">const a = 1;
</code></pre>

$ cmark-gfm --github-pre-lang --full-info-string m.md
<pre lang="用户"><code>你好
</code></pre>
<pre lang="用户" data-meta="v1"><code>z
</code></pre>
<pre lang="Plugin" data-meta="(name)"><code>x
</code></pre>
<pre lang="js"><code>const a = 1;
</code></pre>
```

（`cmark-gfm --version` → `cmark-gfm 0.29.0.gfm.13 - CommonMark with GitHub Flavored Markdown converter`）

### 3.3 一个重要的「坑」：GitHub 不显示标签，只靠高亮

GitHub 网页上，语言名**不会**被渲染成文字标签（不像某些编辑器会显示语言名）。因此用 `用户` 当 info string，在 GitHub 上得到的视觉结果和「完全不带 info string」几乎一样——**零收益**。

---

## 4. 主流渲染器实测矩阵

### 4.1 纯解析/渲染库（Node）

测试输入（`m.md`）：

````markdown
```用户
你好
```

```用户 v1
z
```

```Plugin (name)
x
```

```js
const a = 1;
```
````

输出（`node run-all.cjs`，脚本见附录 A）：

```
### commonmark.js 0.31.2
<pre><code class="language-用户">你好\n</code></pre>\n<pre><code class="language-Plugin">x\n</code></pre>\n<pre><code class="language-用户">z\n</code></pre>\n<pre><code class="language-js">const a = 1;\n</code></pre>\n

### markdown-it 15.0.3
（同上，逐字节一致）

### marked 18.2.1
（同上，逐字节一致）

### remark-parse 11.0.0 (mdast code nodes)
[{"lang":"用户","meta":null},{"lang":"Plugin","meta":"(name)"},{"lang":"用户","meta":"v1"},{"lang":"js","meta":null}]

### remark -> rehype
<pre><code class="language-用户">你好\n</code></pre>\n<pre><code class="language-Plugin">x\n</code></pre>\n<pre><code class="language-用户">z\n</code></pre>\n<pre><code class="language-js">const a = 1;\n</code></pre>
```

要点：

- **四个独立实现的 HTML 输出逐字节一致**，中文 info string 在解析层没有任何特判。
- `remark` 把「第一个词」放 `lang`，其余放 `meta`（`Plugin` + `(name)`、`用户` + `v1`）——这是 §2.1「first word」的另一种实现。
- markdown-it 渲染器源码（`lib/renderer.ts`，v15 dist 反查）明确按空白切分：

```js
const info = token.info ? unescapeAll(token.info).trim() : "";
let langName = ""; let langAttrs = "";
if (info) {
  const arr = info.split(/(\s+)/g);
  langName = arr[0];
  langAttrs = arr.slice(2).join("");
}
```

### 4.2 Obsidian 1.15.1（阅读视图）

Obsidian 不公开源码，但发布包里有完整渲染代码。从 `resources/obsidian.asar` 提取 `app.js`，找到 `case "code"` 对应的渲染函数 `vfe`：

```js
function vfe(o){
  let t = o.value ? o.value + "\n" : "",
      e = o.lang && o.lang.match(/^[^ \t]+(?=[ \t]|$)/),
      i = e ? {className:["language-" + e]} : null,
      r = Qi("code", Cr(i, Or(o)), Cm(t));
  return Qi("pre", "", r.html)
}
```

即：`lang` 取到第一个空白/制表符为止 → `class="language-用户"`。随后走 `registerPostProcessor` 里的 Prism 高亮：

```js
ct.registerPostProcessor(o=>{
  let t=o.findAll('code[class*="language-"]:not(.is-loaded)');
  if(t.length!==0) return zH.then(()=>{ for(let e of t) qd(e), Prism.highlightElement(e), ... })
},100);
```

实测（用 Obsidian 随包的 `/lib/prism.min.js`，PrismJS 1.30.0，jsdom 环境，见附录 A）：

```
lang=用户     pre="language-none"     code="language-用户 language-none"   err=null
lang=ChatGPT  pre="language-chatgpt"  code="language-chatgpt"              err=null
lang=Plugin   pre="language-plugin"   code="language-plugin"               err=null
lang=js       pre="language-js"       code="language-js"                   err=null（内容含 <span class="token keyword"> 等高亮）
```

关键点：

- **不抛错、不破坏结构**，代码块照常渲染，内容照常保留。
- Prism 的 `getLanguage` 用的正则是 `/(?:^|\s)lang(?:uage)?-([\w-]+)(?=\s|$)/i`，`\w` 不含 CJK，所以 `language-用户` 匹配不上 → 语言回落成 `none` → 无害地 encode 原文本。
- 差异：中文时 `pre` 会多一个 `language-none` 类；`ChatGPT` 这种纯 ASCII 未知语言则原样保留 `language-chatgpt`。**两者视觉一致（都不高亮）**。

### 4.3 VS Code 1.147.0 内置 Markdown 预览

本机 `code` 的扩展目录：`/usr/share/code/resources/app/extensions/markdown-language-features/dist/extension.js`。其中预览引擎是 **markdown-it** + **highlight.js**，highlight 回调（压缩后，语义如下）：

```js
highlight: (str, lang) => {
  lang = normalizeLang(lang);                  // shell→sh、csharp→cs 等别名
  if (lang && hljs.getLanguage(lang)) {
    try { return hljs.highlight(str, { language: lang, ignoreIllegals: true }).value } catch {}
  }
  return md.utils.escapeHtml(str);             // 兜底：原样转义
}
```

在浏览器级证据（一个 `hljs.getLanguage` 的实测）：

```js
hljs.getLanguage('用户')     // undefined
hljs.getLanguage('ChatGPT')  // undefined
hljs.getLanguage('js')       // { name: 'JavaScript', ... }
```

复刻该逻辑后实测：

```
"```用户"            => <pre><code class="language-用户">你好\n</code></pre>
"```ChatGPT"         => <pre><code class="language-ChatGPT">**hi**\n</code></pre>
"```Plugin (name)"   => <pre><code class="language-Plugin">x\n</code></pre>
```

同时新版 VS Code 还有一条 `marked` + `languageService.getLanguageIdByLanguageName` 的渲染路径（`src/vs/workbench/contrib/markdown/browser/markdownDocumentRenderer.ts`）：

```ts
const languageId = languageService.getLanguageIdByLanguageName(lang)
  ?? languageService.getLanguageIdByLanguageName(lang.split(/\s+|:|,|(?!^)\{|\?]/, 1)[0]);
return tokenizeToString(languageService, code, languageId);
```

`tokenizeToString` 在 `!languageId` 时明确走 `fallback`（null tokenizer = 纯文本）：

```ts
export async function tokenizeToString(languageService, text, languageId) {
  if (!languageId) return _tokenizeToString(text, languageService.languageIdCodec, fallback);
  ...
}
```

结论：**VS Code 内置预览对中文 info string 完全安全**，只是不高亮。

> 注意：`hljs.highlight(str, {language:'用户'})` 这种**不带 guard** 的调用会 **throw**（见 §4.5），而 VS Code 有 `hljs.getLanguage` 前置判断，所以不会挂。

### 4.4 Typora 1.14.9

Typora 闭源，但发布包的 `resources/appsrc/window/frame.js` 里能拿到围栏起始行的正则：

```js
ie = /^( *(`{3,}|~{3,})[ \t\u00A0]*)([^\n`]+)? *$/   // fence 起始行
u  = /^\s*(`{3,}|~{3,})\s*$/                          // fence 结束行
```

即 info string 捕获组是 ``[^\n`]+``——**除换行和反引号外的一切字符**，中文、空格、全角括号都在内。随后 `window.getCodeMirrorMode(lang)` 把 info 归一化（`toLowerCase()`、去 `lang-`/`language-` 前缀、去 `{}`、按 `[\s,]+` 切第一个 token）去查 CodeMirror 语言模式，查不到就返回 null（= 不高亮）。

实测该正则（用 Node 复刻，见附录 A）：

```
"```用户"                fence? true | info = "用户" | mode token = "用户"
"```Plugin (name)"      fence? true | info = "Plugin (name)" | mode token = "plugin"
"```用户 v1"             fence? true | info = "用户 v1" | mode token = "用户"
"```插件（name）"          fence? true | info = "插件（name）" | mode token = "插件（name）"
"```ChatGPT"            fence? true | info = "ChatGPT" | mode token = "chatgpt"
```

> **限定说明**：Typora 的实际渲染器是编译进 `main.node` 的原生代码，没能无头运行 GUI 做像素级验证；上面是「围栏识别」这一层的源码级证据（info string 会被完整接受），高亮缺失是 CodeMirror mode 查不到的必然结果。**GUI 内的最终视觉未实测**——保守记为「未完全确认」。

### 4.5 highlight.js / Prism / Shiki 的 API 级行为（渲染器的地基）

这决定了「某个编辑器/网站用得很开心，换个站就炸」的边界：

```js
// highlight.js 11.12.0 —— 直接指定未知语言
hljs.highlight('hello', { language: '用户' })
// → throw Error: Unknown language: "用户"

hljs.getLanguage('用户')  // undefined（无异常，可安全用于守卫）

// PrismJS 1.30.0 —— 走 DOM 的 highlightElement
Prism.languages['用户']  // undefined
Prism.highlight('你好', Prism.languages['用户'], '用户')
// → throw Error: The language "用户" has no grammar.
// 但 Prism.highlightElement(el) 内部对 !grammar 有兜底：insertHighlightedCode(_.util.encode(env.code))
//   → 不抛错、不改内容、只是不高亮

// Shiki 4.6.0
await codeToHtml('x', { lang: '用户' })
// → throw ShikiError: Language `用户` not found, you may need to load it first

// lowlight（rehype-highlight 底层）
lowlight.highlight('用户', 'const a=1')
// → throw Error: Unknown language: `用户` is not registered
```

实测「不带 guard 的 markdown-it + hljs」会把整个渲染炸掉：

```js
const md = new MarkdownIt({ highlight: (str, lang) =>
  hljs.highlight(str, { language: lang }).value });
md.render('```用户\n你好\n```\n');
// → Error: Unknown language: "用户"
```

而带 guard（VS Code / markdown-it-highlightjs 的写法）就安全：

```js
if (lang && hljs.getLanguage(lang)) { try { ... } catch {} }
return md.utils.escapeHtml(code);
// → <pre><code class="hljs language-用户">你好\n</code></pre>
```

**这就是「中文 info string 的真实风险」**：它本身合法，但把一个**未注册的语言名**喂给了下游高亮器。任何一处没做 `getLanguage` 守卫的集成都会从「不高亮」升级成「渲染异常 / 构建失败」（Shiki 场景下是整站构建报错）。

> 附带观察：`language-用户` 在 highlight.js 走 `highlightElement`（DOM 自动高亮）时，由于 `languageDetectRe = /\blang(?:uage)?-([\w-]+)\b/i` 里的 `\w` 不含 CJK，正则匹配不上 → 落到 `highlightAuto()` → **内容会被误判成某种随机语言并染色**：
>
> ```
> language-用户  → class="language-用户 hljs language-abnf"   （内容被打上 <span class="hljs-operator">...）
> language-ChatGPT → class="language-ChatGPT"                  （正确回落 no-highlight）
> ```
>
> 这是「CJK 语言名」特有的一个副作用：ASCII 未知语言会干净地回落，CJK 未知语言会被当成「没有语言」进而触发自动侦测。

### 4.6 站点生成器：Hugo（goldmark）与 pandoc

```bash
# Hugo 0.167.0 + extended
$ hugo
<pre tabindex="0"><code class="language-用户" data-lang="用户">你好
</code></pre>
<!-- js 那段被 Chroma 高亮成 <div class="highlight">... -->

# pandoc 3.14
$ pandoc -f gfm -t html m.md
<pre class="用户"><code>你好</code></pre>
<pre class="Plugin"><code>x</code></pre>
<pre class="用户"><code>z</code></pre>
<div class="sourceCode" id="cb4"><pre class="sourceCode js">...（高亮）</div>
```

pandoc 的 AST 很直白地显示「第一个词 = class」：

```
[ CodeBlock ( "" , [ "\29992\25143" ] , [] ) ...   -- "用户"
, CodeBlock ( "" , [ "Plugin" ] , [] ) "x"
, CodeBlock ( "" , [ "\29992\25143" ] , [] ) "z"
```

> pandoc 用 `class="用户"` 而**不是** `class="language-用户"`——这是 pandoc 的既定行为（语言名直接作为 class + 额外 `sourceCode`），不是中文特例。

### 4.7 Notion 导入

**未确认**。没有可用的 Notion 账号做导入实测。可查的间接证据：Notion API 的 `code` block `language` 字段是一个**封闭枚举**（`LanguageRequest`，见 `@notionhq/client` 的 `api-endpoints/common.d.ts`，含 `"plain text"` 兜底项），没有「任意字符串」。因此合理推测导入时会落到 `plain text`，但**这是推测，不是实测**。

---

## 5. info string 里带空格是否合法（`Plugin (name)`）

### 5.1 规范层面：合法

CommonMark/GFM 对 info string 的约束只有「backtick fence 不得含反引号」。空格当然可以：§4.5 的 Example 143 就是反例证明——`~~~~    ruby startline=3 $%@#$` 里的 `startline=3 $%@#$` 全都成了 info 的一部分，只是「第一个词」`ruby` 被拿去当语言名。

三个实现的表现（实测）：

| 实现 | 以 `Plugin (name)` 作 info string 的结果 |
|---|---|
| commonmark.js / markdown-it / marked / remark | `class="language-Plugin"`，`(name)` 进 `meta` / `langAttrs`，**无害** |
| cmark-gfm（GitHub） | `<pre lang="Plugin" data-meta="(name)">`，**无害** |
| pandoc | `class="Plugin"`，**无害** |
| Hugo/goldmark | `class="language-Plugin" data-lang="Plugin"`，**无害** |
| **Python-Markdown `fenced_code`（MkDocs 默认）** | `<p><code>Plugin (name)\nx</code></p>` —— **整个围栏失效** |
| **pymdownx.superfences（默认 `relaxed_headers=False`）** | `<p><code>Plugin (name)\nx</code></p>` —— **同样失效** |

### 5.2 Python-Markdown 为什么会坏

`markdown/extensions/fenced_code.py` 的围栏正则：

```python
FENCED_BLOCK_RE = re.compile(dedent(r'''
    (?P<fence>^(?:~{3,}|`{3,}))[ ]*                          # opening fence
    ((\{(?P<attrs>[^\n]*)\})|                                # (optional {attrs} or
    (\.?(?P<lang>[\w#.+-]*)[ ]*)?                            # optional (.)lang
    (hl_lines=(?P<quot>"|')(?P<hl_lines>.*?)(?P=quot)[ ]*)?) # optional hl_lines)
    \n                                                       # newline (end of opening fence)
    ...
'''))
```

关键：`(?P<lang>[\w#.+-]*)[ ]*` 之后**必须紧跟** `\n`（或 `hl_lines=`）。所以：

- `用户` → `[\w#.+-]*` 在 Python 3 里 `\w` 是 Unicode-aware，**能匹配中文** → 正常（实测 `class="language-用户"`）。
- `用户 v1` / `Plugin (name)` / `js v1` → 空格后面还有内容 → **不匹配围栏正则** → 整块退化成普通段落，``` 变成行内代码。

`pymdownx.superfences` 的正则 `RE_NESTED_FENCE_START` 里有 `(?P<unrecognized>(?:([ \t]*[^\s]+)(?=[\t ]|$))+)` 分支，本意是兜住「不认识的头」；但 `relaxed_headers` 默认 `False`（`self.relaxed_headers = self.config.get('relaxed_headers', False)`），于是 `handle_unrecognized` 直接返回 `False`，围栏同样失效。

> 也就是说：**「带空格」这个问题跟中文完全无关**，ASCII 的 `js v1` 在 MkDocs 下一样坏。但既然需求里的 `Plugin (name)` 天然带空格，这条必须记住。

### 5.3 补充：全角空格 U+3000 是「非空白」

因为 cmark 的 `cmark_isspace` 只认 ASCII 空白，四反引号 + `用户　extra`（U+3000）会被当成**一个完整的词**：

```bash
$ printf '```用户\u3000extra\nx\n```\n' | cmark-gfm --github-pre-lang
<pre lang="用户　extra"><code>x
</code></pre>
```

而 markdown-it / marked 用 JS 的 `\s`（`\s` 含 U+3000），会把它切开：

```
markdown-it: <pre><code class="language-用户">foo\n</code></pre>
marked     : <pre><code class="language-用户">foo\n</code></pre>
```

**实现分歧点**。这也是「info string 里别放奇怪字符」的另一个理由。

---

## 6. 结论与替代方案

### 6.1 直接回答工单的 5 个问题

| # | 问题 | 答案 |
|---|---|---|
| 1 | CommonMark 对 info string 的字符约束？第一个词是不是语言标识？ | 只禁反引号（backtick fence）与跨行；**无 ASCII 限制**，规范自己的 Example 34 就产出 `class="language-föö"`。「第一个词」= 语言名，但「spec does not mandate any particular treatment」 |
| 2 | GFM / GitHub 用 `用户` 作 info string 会怎样？ | **不会破坏语法**。仍是代码块，`<pre lang="用户">`，**未知语言 → 无高亮**。实测（api.github.com/markdown + cmark-gfm 0.29.0.gfm.13） |
| 3 | Obsidian / Typora / VS Code / Notion？ | Obsidian ✅（无高亮，链接 Prism 回落 `language-none`）；Typora 围栏可识别、无高亮（GUI 未实测，**未完全确认**）；VS Code ✅（无高亮，`getLanguage` 兜底 `escapeHtml`）；Notion **未确认** |
| 4 | info string 带空格（`Plugin (name)`）合法吗？ | **规范合法**；GitHub/VS Code/commonmark.js/markdown-it/remark/pandoc/Hugo 都无害；但 **Python-Markdown `fenced_code`（MkDocs 默认）与 pymdownx.superfences 会整块失效**（ASCII 也一样） |
| 5 | 中文角色名能不能直接当 fence info？ | **语法上安全，语义上无收益，生态上有真实地雷**（未 guard 的 hljs 集成会 throw、Shiki 构建报错、hljs DOM 自动侦测会乱染色）。**推荐退回 ASCII**，详见 6.2 |

### 6.2 推荐方案

**推荐：固定 ASCII 语言标识 + 角色名放围栏内第一行。**

````markdown
```text
[用户] 12:34
你好，这是正文。
```
````

理由：

1. **`text` 是真实注册的「Plain text」**：`hljs.getLanguage('text')` → `{name:'Plain text'}`、`Prism.languages.text` → 存在、Shiki 的 `text` → 存在。三个高亮器都不会 throw，也不会自动侦测乱染色——这是**唯一能吃掉所有兜底路径**的选择。
2. 角色名放块内是**纯内容**，不参与语法，任何渲染器都不会误解。
3. 若需要「角色名可见且语义化」，也可以留在围栏**外**（如 `**用户** · 12:34` 作为一段），围栏只在正文确实需要「原样保留」时使用。

**如果产品上确实想让角色名进 info string**（例如为了在 Typora 语言下拉框里显示「用户」），那么底线是：

- 只用**单个词**、不含空格、不含反引号、不含 U+3000 全角空格；
- 在导出侧自己维护一张「角色 → ASCII 语言 ID」映射表（不直接用 `t('markdown.authorUser')`），例如 `user` / `chatgpt` / `plugin`；
- 明确接受「所有地方都不高亮」这一后果，并在 ADR 里写死。

**绝对不要**：把 `Plugin (name)`（带空格 + 括号）直接塞进 info string——MkDocs 会整块失效。

### 6.3 对 #30（围栏消息块精确格式）的直接输入

- 语言标识：建议**定死 ASCII**，与 locale 解耦。`t('markdown.authorUser')` 只用于**块内正文**或围栏外标签，不用于 info string。
- 空格问题：`Plugin (name)` 无论中文英文，只要进 info string 就有 MkDocs 破坏风险 → 强化「角色名不进 info string」的结论。
- 4 反引号嵌套（#30 第 4 项）与本工单无关；但 4 反引号围栏带中文 info string（即四个反引号 + `用户`）在所有实测实现里行为与三反引号相同，无差异。

---

## 附录 A：实测环境与脚本

### A.1 环境

| 项 | 版本 |
|---|---|
| OS | Linux x86_64 |
| Node | v24.21.0 |
| pnpm / npm | 10.32.1 / npm 内置 |
| cmark-gfm | 0.29.0.gfm.13 |
| pandoc | 3.14 |
| Hugo | 0.167.0+extended |
| Python | 3.14.7 |
| Node 库 | commonmark.js 0.31.2、markdown-it 15.0.3、marked 18.2.1、remark-parse 11.0.0、@lezer/markdown 1.8.1、highlight.js 11.12.0、prismjs 1.30.0、shiki 4.6.0、markdown-it-highlightjs 4.3.0、rehype-highlight、lowlight |
| Python 库 | markdown 3.11.3、pymdownx 13.1.2、mistune 3.4.0、markdown-it-py 4.3.0 |
| 应用 | Obsidian 1.15.1（`obsidian.asar` 提取）、Typora 1.14.9（`frame.js` 提取）、VS Code 1.147.0（`markdown-language-features/dist/extension.js`） |

安装位置：`/tmp/opencode/mdtest`（npm）、`/tmp/opencode/py`（pip --target）、`/tmp/opencode/obsidian-1.15.1`、`/tmp/opencode/typora`。

### A.2 输入样例 `m.md`

````markdown
```用户
你好
```

```用户 v1
z
```

```Plugin (name)
x
```

```js
const a = 1;
```
````

### A.3 Node 多引擎对照（`/tmp/opencode/mdtest/run-all.cjs`）

```js
const fs = require('fs');
const src = '```用户\n你好\n```\n\n```Plugin (name)\nx\n```\n\n```用户 v1\nz\n```\n\n```js\nconst a = 1;\n```\n';
const oneline = (s) => s.replace(/\n/g, '\\n');
const ver = (p) => JSON.parse(fs.readFileSync('node_modules/' + p + '/package.json', 'utf8')).version;

const cm = require('commonmark');
console.log('### commonmark.js ' + ver('commonmark'));
console.log(oneline(new cm.HtmlRenderer().render(new cm.Parser().parse(src))));

const MarkdownIt = require('markdown-it');
console.log('\n### markdown-it ' + ver('markdown-it'));
console.log(oneline(new MarkdownIt('commonmark').render(src)));

const { marked } = require('marked');
console.log('\n### marked ' + ver('marked'));
console.log(oneline(marked.parse(src)));

(async () => {
  const { unified } = await import('unified');
  const remarkParse = (await import('remark-parse')).default;
  const remarkRehype = (await import('remark-rehype')).default;
  const rehypeStringify = (await import('rehype-stringify')).default;
  const tree = unified().use(remarkParse).parse(src);
  console.log('\n### remark-parse ' + ver('remark-parse') + ' (mdast code nodes)');
  console.log(JSON.stringify(tree.children.filter((n) => n.type === 'code').map((n) => ({ lang: n.lang, meta: n.meta }))));
  console.log('\n### remark -> rehype');
  console.log(oneline(String(await unified().use(remarkParse).use(remarkRehype).use(rehypeStringify).process(src))));
})();
```

输出见 §4.1。

### A.4 VS Code 内置预览逻辑复刻（`vscode-like.cjs`）

```js
const MarkdownIt = require('markdown-it');
const hljs = require('highlight.js');
function normalize(t) {
  switch ((t || '').toLowerCase()) {
    case 'shell': return 'sh';
    case 'python3': case 'py3': return 'python';
    case 'c#': case 'csharp': return 'cs';
    default: return t;
  }
}
let md;
md = new MarkdownIt({
  html: true,
  highlight(str, lang) {
    lang = normalize(lang);
    if (lang && hljs.getLanguage(lang)) {
      try { return hljs.highlight(str, { language: lang, ignoreIllegals: true }).value; } catch {}
    }
    return md.utils.escapeHtml(str);
  }
});
for (const c of ['```用户\n你好\n```\n', '```ChatGPT\n**hi**\n```\n', '```Plugin (name)\nx\n```\n']) {
  console.log(JSON.stringify(c.split('\n')[0]), '=>', md.render(c).replace(/\n/g, '\\n'));
}
```

输出：

```
"```用户" => <pre><code class="language-用户">你好\n</code></pre>\n
"```ChatGPT" => <pre><code class="language-ChatGPT">**hi**\n</code></pre>\n
"```Plugin (name)" => <pre><code class="language-Plugin">x\n</code></pre>\n
```

### A.5 Obsidian 渲染管线复刻（`prism.cjs`）

````js
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><title>t</title>');
global.window = dom.window; global.document = dom.window.document;
global.Element = dom.window.Element; global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;
// Obsidian 1.15.1 随包 /lib/prism.min.js（PrismJS 1.30.0），
// 由 asar.listPackage() + asar.extractFile() 从 obsidian.asar 取出
const Prism = require('/tmp/opencode/obs/prism.min.js');

function run(lang) {
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.className = 'language-' + lang;      // 对应 app.js 的 vfe(): className:["language-"+lang]
  code.textContent = 'const a = 1;';
  pre.appendChild(code);
  document.body.appendChild(pre);
  let err = null;
  try { Prism.highlightElement(code); } catch (e) { err = e.message; }
  return { pre: pre.className, code: code.className, err, html: code.innerHTML };
}
for (const l of ['用户', 'ChatGPT', 'Plugin', 'js', '插件']) {
  const r = run(l);
  console.log(l.padEnd(8), JSON.stringify({ pre: r.pre, code: r.code, err: r.err, html: r.html.slice(0, 60) }));
}

console.log('Prism.languages["用户"] =', Prism.languages['用户']);
try { Prism.highlight('你好', Prism.languages['用户'], '用户'); }
catch (e) { console.log('Prism.highlight() THROW:', e.message); }
````

输出：

```
用户       {"pre":"language-none","code":"language-用户 language-none","err":null,"html":"const a = 1;"}
ChatGPT  {"pre":"language-chatgpt","code":"language-chatgpt","err":null,"html":"const a = 1;"}
Plugin   {"pre":"language-plugin","code":"language-plugin","err":null,"html":"const a = 1;"}
js       {"pre":"language-js","code":"language-js","err":null,"html":"<span class=\"token keyword\">const</span> a <span class=\"toke"}
插件       {"pre":"language-none","code":"language-插件 language-none","err":null,"html":"const a = 1;"}
Prism.languages["用户"] = undefined
Prism.highlight() THROW: The language "用户" has no grammar.
```

### A.6 Typora 围栏正则复刻（`typora-regex2.cjs`）

```js
// Typora 1.14.9 · resources/appsrc/window/frame.js 原文
const FENCE_START = /^( *(`{3,}|~{3,})[ \t\u00A0]*)([^\n`]+)? *$/;
const FENCE_END = /^\s*(`{3,}|~{3,})\s*$/;

// window.getCodeMirrorMode 的 token 归一化
function modeToken(lang) {
  const e = (lang ? lang.toLowerCase() : '')
    .replace(/^\s*\.*lang(uage)*-/g, '').replace(/[{}]/g, '').trim();
  return (e.split(/[\s,]+/) || [e])[0];
}

for (const line of ['```用户', '```Plugin (name)', '```用户 v1', '```js', '```插件（name）', '```ChatGPT']) {
  const m = line.match(FENCE_START);
  console.log(JSON.stringify(line), 'fence?', !!m, '| info =', JSON.stringify(m && m[3]), '| mode token =', JSON.stringify(m && modeToken(m[3] ?? '')));
}
console.log('closing fence "```" ->', FENCE_END.test('```'), ' "``` 用户" ->', FENCE_END.test('``` 用户'));
```

输出：

```
"```用户"                fence? true | info = "用户" | mode token = "用户"
"```Plugin (name)"      fence? true | info = "Plugin (name)" | mode token = "plugin"
"```用户 v1"             fence? true | info = "用户 v1" | mode token = "用户"
"```js"                 fence? true | info = "js" | mode token = "js"
"```插件（name）"          fence? true | info = "插件（name）" | mode token = "插件（name）"
"```ChatGPT"            fence? true | info = "ChatGPT" | mode token = "chatgpt"
closing fence "```" -> true  "``` 用户" -> false
```

### A.7 高亮器 API 探测

```js
// highlight.js 11.12.0
const hljs = require('highlight.js');
hljs.getLanguage('用户');     // undefined
hljs.getLanguage('ChatGPT');  // undefined
hljs.getLanguage('js');       // { name: 'JavaScript', ... }
hljs.highlight('hello', { language: '用户' });
// throw Error: Unknown language: "用户"
```

```js
// PrismJS（Obsidian 随包 1.30.0）
Prism.languages['用户']  // undefined
```

```js
// shiki 4.6.0
const { createHighlighter } = await import('shiki');
const hl = await createHighlighter({ themes: ['nord'], langs: ['js', 'text'] });
hl.codeToHtml('const a=1', { lang: 'js',    theme: 'nord' }); // OK
hl.codeToHtml('**hi**',    { lang: 'text',   theme: 'nord' }); // OK（Plain text）
hl.codeToHtml('x',         { lang: '用户',   theme: 'nord' });
// throw ShikiError: Language `用户` not found, you may need to load it first
```

```js
// highlight.js 的 DOM 自动高亮（highlightElement）对 CJK 类名的误判
// languageDetectRe = /\blang(?:uage)?-([\w-]+)\b/i   —— \w 不含 CJK
/\blang(?:uage)?-([\w-]+)\b/i.exec('language-用户 ')    // null
/\blang(?:uage)?-([\w-]+)\b/i.exec('language-ChatGPT ') // "ChatGPT"

// 实测 DOM 高亮结果：
// language-用户     → class="language-用户 hljs language-abnf"   （内容被自动侦测染色）
// language-ChatGPT  → class="language-ChatGPT"                  （正确回落 no-highlight）
```

### A.8 Python-Markdown 与 superfences

```python
import markdown
cases = {
 'cjk': '```用户\n你好\n```\n',
 'cjk_meta': '```用户 v1\n你好\n```\n',
 'plugin_paren': '```Plugin (name)\nx\n```\n',
 'js_meta': '```js v1\nvar a=1;\n```\n',
}
for exts in (['fenced_code'], ['pymdownx.superfences']):
    print(exts)
    for k, v in cases.items():
        print(' ', k, '=>', repr(markdown.markdown(v, extensions=exts)))
```

输出：

```
['fenced_code']
  cjk          => '<pre><code class="language-用户">你好\n</code></pre>'
  cjk_meta     => '<p><code>用户 v1\n你好</code></p>'
  plugin_paren => '<p><code>Plugin (name)\nx</code></p>'
  js_meta      => '<p><code>js v1\nvar a=1;</code></p>'
['pymdownx.superfences']
  cjk          => '<div class="highlight"><pre><span></span><code>你好\n</code></pre></div>'
  cjk_meta     => '<p><code>用户 v1\n你好</code></p>'
  plugin_paren => '<p><code>Plugin (name)\nx</code></p>'
  js_meta      => '<p><code>js v1\nvar a=1;</code></p>'
```

### A.9 GitHub API 实测

```bash
gh api /markdown -f mode=gfm -f text='```用户
你好
```'
# <pre lang="用户" class="notranslate"><code class="notranslate">你好
# </code></pre>
```

---

## 附录 B：参考来源

**规范 / 参考实现**

- CommonMark 0.31.2 §4.5 Fenced code blocks — <https://spec.commonmark.org/0.31.2/#fenced-code-blocks>
- CommonMark 0.31.2 §2.5 Entity and numeric character references（Example 34，`language-föö`）— <https://spec.commonmark.org/0.31.2/#entity-and-numeric-character-references>
- CommonMark spec 源码 `spec.txt` — <https://github.com/commonmark/commonmark-spec/blob/master/spec.txt>
- GFM 规范 §4.5 — <https://github.github.com/gfm/#fenced-code-blocks>
- cmark-gfm `src/scanners.re`（`_scan_open_code_fence`）— <https://github.com/github/cmark-gfm/blob/master/src/scanners.re>
- cmark-gfm `src/blocks.c`（info string 提取）— <https://github.com/github/cmark-gfm/blob/master/src/blocks.c>
- cmark-gfm `src/html.c`（`first_tag` 切词 / `data-meta`）— <https://github.com/github/cmark-gfm/blob/master/src/html.c>
- cmark-gfm `src/cmark_ctype.c`（`cmark_isspace` 仅 ASCII）— <https://github.com/github/cmark-gfm/blob/master/src/cmark_ctype.c>
- GitHub Markdown 渲染 API — <https://docs.github.com/en/rest/markdown>

**渲染器**

- VS Code `markdown-language-features`（本机 1.147.0 的 `dist/extension.js`；上游 `src/vs/workbench/contrib/markdown/browser/markdownDocumentRenderer.ts`）
- VS Code `getLanguageIdByLanguageName` — <https://github.com/microsoft/vscode/blob/main/src/vs/editor/common/languages/language.ts>
- VS Code `tokenizeToString` — <https://github.com/microsoft/vscode/blob/main/src/vs/editor/common/languages/textToHtmlTokenizer.ts>
- Obsidian 1.15.1 `resources/obsidian.asar` 内 `app.js`（`vfe` 代码块渲染、Prism post-processor）与 `/lib/prism.min.js`（PrismJS 1.30.0）
- Typora 1.14.9 `resources/appsrc/window/frame.js`（围栏正则、`window.getCodeMirrorMode`）
- Typora Code Fences 文档 — <https://support.typora.io/Code-Fences/>
- Obsidian Basic formatting syntax（Prism 说明）— <https://help.obsidian.md/Editing+and+formatting/Basic+formatting+syntax>
- highlight.js `blockLanguage` / `languageDetectRe` — <https://github.com/highlightjs/highlight.js/blob/main/src/core.js>
- PrismJS `highlightElement` / `util.getLanguage` — <https://github.com/PrismJS/prism/blob/master/prism.js>
- Shiki `codeToHtml` 未知语言报错 — <https://shiki.style/>
- Python-Markdown `fenced_code.py`（`FENCED_BLOCK_RE`）— <https://github.com/Python-Markdown/markdown/blob/master/markdown/extensions/fenced_code.py>
- pymdownx `superfences.py`（`RE_NESTED_FENCE_START`、`relaxed_headers`）— <https://github.com/facelessuser/pymdown-extensions/blob/main/pymdownx/superfences.py>
- MkDocs 默认 `markdown_extensions`（含 `fenced_code`）— <https://www.mkdocs.org/user-guide/configuration/>
- Notion API `LanguageRequest` 枚举 — `@notionhq/client` `build/src/api-endpoints/common.d.ts`

**仓库内相关**

- `src/locales/zh_CN.json` → `markdown.authorUser = "用户"`、`markdown.authorPlugin = "插件"`
- `src/markdown/conversation-to-markdown.ts` → `renderMessageBlock()`（当前仍是 `---` + `## 角色`）
- Issue #30「围栏消息块的精确输出格式」— <https://github.com/devcxl/chatgpt-markdown-exporter/issues/30>

---

## 未确认项清单

| 项 | 状态 | 原因 |
|---|---|---|
| Typora GUI 内的最终视觉效果 | **未完全确认** | 渲染器编译进 `main.node`，无法无头运行；仅有围栏正则与 CodeMirror mode 查找的源码级证据 |
| Notion Markdown 导入的 info string 处理 | **未确认** | 无可用账号实测；仅有 API `language` 枚举（封闭集合，含 `"plain text"`）作为间接推断 |
| Obsidian Live Preview / 源码模式 | **未确认** | 这两处不用 PrismJS（官方帮助文档明确说「Source mode 和 Live Preview 不支持 PrismJS」），本报告只验证了阅读视图 |
