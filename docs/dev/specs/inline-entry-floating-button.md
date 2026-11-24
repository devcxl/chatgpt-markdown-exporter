# 技术方案：页内导出入口改为固定浮层

- 状态：待实现
- 关联 ADR：`docs/adr/2026-11-24-inline-entry-floating-button.md`
- 关联 issue： [#31](https://github.com/devcxl/chatgpt-markdown-exporter/issues/31)
- 涉及模块：`src/entrypoints/chatgpt.content/current-export-button.ts`、`src/entrypoints/chatgpt.content/index.ts`

## 1. 目标

页内「导出当前对话」按钮改为**永久固定在视口右下角**的浮层控件，与 ChatGPT 的 DOM 结构彻底解耦；删除整套寄宿、观察与几何避让代码。

## 2. 现状

`current-export-button.ts` 共 475 行，三级挂载策略：

| 级别 | 锚点 | 2026-11-24 实测 |
|---|---|---|
| 1 | `[data-app-shell-header-obstacle="true"]` + `ms-auto` + `gap-toolbar-action` | 不存在（数量 0） |
| 2 | `#conversation-header-actions` | 不存在 |
| 3 | 浮层，`fixed` 定位，按 `TITLEBAR_SELECTOR` 与 header 几何找空位 | 正在生效 |

后果：`findToolbarTarget()` 恒返回 `null`，第 1、2 级与「空位检测」全部是死代码；`MutationObserver` 仍在每次 DOM 变更时跑一遍收敛逻辑（自激风险已在注释中记录）。

## 3. 方案

### 3.1 新的 `current-export-button.ts`

```
mountCurrentExportButton(onExport)
  ├─ createButton()        // 图标 + t('common.export')，id 不变
  ├─ injectButtonStyles()  // 自包含样式，position: fixed
  └─ document.body.appendChild(button)
```

- 幂等：`document.getElementById(CURRENT_EXPORT_BUTTON_ID)` 已存在则直接返回（保持现状）
- 无观察器、无 `reconcile`、无几何计算；SPA 路由切换时按钮不受影响（挂在 `body`，不随内容区重建）
- 点击回调保持现有语义：忽略 `!event.isTrusted`

### 3.2 样式

```css
#cgpt-export-current-button {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2147483000;
  /* 其余（尺寸、圆角、字体、hover、focus-visible、图标）沿用现有自包含样式 */
  background: var(--color-surface-elevated, Canvas);
  border: 1px solid var(--color-border-light, rgba(128,128,128,0.3));
  box-shadow: 0 2px 8px rgba(0,0,0,0.18);
}
@media (max-width: 639px) { #cgpt-export-current-button { display: none; } }
```

颜色继续优先取宿主 CSS 变量并带 fallback；因是浮层，背景与投影必须自带。

### 3.3 删除清单（Clean Break）

导出符号与内部函数：`findToolbarTarget`、`isElementVisible`、`isVisibleByComputedStyle`、`isExternalMutation`、`reconcileButtonPosition`、`positionFloating`、`collectHeaderOccupancy`、`findRightmostGap`、`getButtonWidth`、`getButtonHeight`、`attachTo`、`findMountTarget`、`observeHeader`、`CHECK_VISIBILITY_OPTIONS`。

常量：`TOOLBAR_OBSTACLE_SELECTOR`、`TOOLBAR_LAYOUT_CLASS`、`TOOLBAR_GROUP_CLASS`、`LEGACY_HEADER_SELECTOR`、`TITLEBAR_SELECTOR`、`HEADER_INTERACTIVE_SELECTOR`、`FALLBACK_GAP`、`FALLBACK_TOP_FALLBACK`、`CURRENT_EXPORT_FALLBACK_ATTR`、`CURRENT_EXPORT_BUTTON_STYLE_ID` 保留（仍需要唯一性）。

类型：`MountTarget`、`MountResult` 删除。

`index.ts` 与导出逻辑**不改**。

## 4. 测试

`current-export-button.test.ts` 全部重写为不变量测试：

| 用例 | 断言 |
|---|---|
| 挂载 | `document.body` 直接子元素；`id` 为 `cgpt-export-current-button` |
| 幂等 | 连续调用两次挂载，DOM 中只有一个按钮 |
| 样式注入 | `<head>` 中样式节点唯一，且包含 `position: fixed` |
| 点击 | trusted 事件触发回调；`isTrusted=false` 不触发 |
| 点击后 DOM 不变 | 不移动、不新增节点（证明没有观察器在动） |

覆盖率仍须满足全局 90% 阈值。

## 5. 边界与风险

| 场景 | 处理 |
|---|---|
| 无会话页（`/`）点击 | 沿用现有错误 toast（`getCurrentChatId()` 抛错被捕获） |
| 分享页 `/share/*` | 与现在一致，按钮可见且可用 |
| 右下角被宿主控件占用 | 已知风险，需实机目视确认；冲突时只调整 `right/bottom` 数值，不改结构 |
| 移动端窄屏 | 沿用 `display: none` |

## 6. 验收

- `pnpm typecheck && pnpm lint && pnpm test` 全绿
- `pnpm build` 产物在项目页、普通对话页、分享页、首页四处，按钮均出现在右下角且可用
- `current-export-button.ts` 行数显著下降（预期 < 150 行），无遗留未引用符号（`noUnusedLocals` 会强制）
