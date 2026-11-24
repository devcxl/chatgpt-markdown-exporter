---
title: 页内入口改为固定浮层
id: task-003
parent: 31
issue: null
depends_on: []
assignee: backend
status: ready
---

# task-003: 页内入口改为固定浮层

## 目标

把「导出当前对话」按钮改成永久固定在视口右下角的浮层，删除整套寄宿、观察与几何避让代码。依据 `docs/dev/specs/inline-entry-floating-button.md`。

## 范围

| 文件 | 操作 |
|---|---|
| `src/entrypoints/chatgpt.content/current-export-button.ts` | 重写（475 行 → 预期 < 150 行） |
| `src/entrypoints/chatgpt.content/current-export-button.test.ts` | 重写 |

`src/entrypoints/chatgpt.content/index.ts` 不改。

## 实现要点（依据 spec §3）

1. `mountCurrentExportButton(onExport)` 收敛为：幂等检查 → `createButton()` → `injectButtonStyles()` → `document.body.appendChild`
2. 按钮样式改为 `position: fixed; right: 16px; bottom: 16px`，背景/边框/投影自带（浮层必须有），其余尺寸与 hover/focus 沿用现值
3. 删除全部锚点常量、`findToolbarTarget` / `findMountTarget` / `attachTo` / `reconcileButtonPosition` / `positionFloating` / `collectHeaderOccupancy` / `findRightmostGap` / `getButtonWidth` / `getButtonHeight` / `isElementVisible` / `isVisibleByComputedStyle` / `observeHeader` / `isExternalMutation` / `CHECK_VISIBILITY_OPTIONS` / `MountTarget` / `MountResult` / `CURRENT_EXPORT_FALLBACK_ATTR`
4. 点击语义不变：`!event.isTrusted` 直接 return
5. 保留 `@media (max-width: 639px) { display: none }`

## 测试（依据 spec §4）

| 用例 | 断言 |
|---|---|
| 挂载 | `body` 直接子元素，`id` 正确 |
| 幂等 | 连续两次调用只有一个按钮 |
| 样式 | `<head>` 中唯一 style 节点，含 `position: fixed` |
| 点击 | trusted 触发回调，`isTrusted=false` 不触发 |
| 无自移动 | 点击后按钮父节点与 DOM 结构不变 |

## 验收

- `pnpm typecheck && pnpm lint && pnpm test` 全绿
- 构建产物在项目页 / 普通对话页 / 分享页 / 首页，按钮都在右下角且可点
- `noUnusedLocals` 无报错（证明没有遗留死符号）
