---
title: 导出统计核心纯函数（countWords / countLines）
id: task-001
parent: 1
issue: 2
depends_on: []
assignee: backend
status: ready
---

# task-001: 导出统计核心纯函数（countWords / countLines）

## 目标

新增 `src/markdown/stats.ts` 纯函数模块，提供 `countWords` 与 `countLines` 两个无副作用统计函数，并配套完整单测。本任务不触碰渲染管线，输出可独立合并。

## 范围

| 文件 | 操作 |
|---|---|
| `src/markdown/stats.ts` | 新增 |
| `src/markdown/stats.test.ts` | 新增 |

不改动任何现有文件。

## 实现要点（依据技术方案 §2.2、§2.3、§3.1）

### countWords(text: string): number

```
hanCount   = text 中 \p{Script=Han} 字符的数量
nonHanText = text 剔除所有 Han 字符，并将 CJK 标点（\u3000-\u303F、\uFF00-\uFFEF）替换为空格
wordCount  = nonHanText 按 /\s+/ 分割后的非空段数量
word_count = hanCount + wordCount
```

- 中文判定使用 Unicode 属性 `\p{Script=Han}`（含扩展区汉字），`/gu` flag
- 中文标点不计；英文标点附着单词不单独计数
- 不做 Markdown 语法剥离、不剥离代码块/URL（无空格连续串计 1 词）
- 空串/纯空白 → 0

### countLines(text: string): number

```
countLines(text) = text.trim() 为空 ? 0 : text.trim().split('\n').length
```

- 尾部空行被 trim 剔除不计；中间空行是真实行，计入

## 测试用例（stats.test.ts）

`countWords`：

| 输入 | 期望 |
|---|---|
| `Hello world` | 2 |
| `Hello, world!` | 2 |
| `你好世界` | 4 |
| `你好，世界！` | 4 |
| `Hello世界` | 3 |
| `好的，let me check` | 5 |
| `123 456` | 2 |
| `Visit https://example.com now` | 3 |
| `` `const x = 1;` `` | 3 |
| `''` / `'   '` | 0 |

`countLines`：

| 输入 | 期望 |
|---|---|
| `''` | 0 |
| `'a'` | 1 |
| `'a\nb'` | 2 |
| `'a\n\nb'` | 3 |
| `'a\n\n'` | 1 |

测试模式沿用 `src/shared/zip-core.test.ts`（同目录同名 `.test.ts`、`describe/it/expect`）。

## 验收要点

1. `pnpm typecheck` 通过（`noUnusedLocals` 无报错）
2. `pnpm lint` 通过
3. `pnpm test` 全绿（含新增 stats.test.ts）
4. 两个函数均无副作用，仅依赖字符串参数
