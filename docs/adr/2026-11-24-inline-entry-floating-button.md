# ADR：页内导出入口改为固定浮层

- 日期：2026-11-24
- 状态：已接受
- 关联 issue： [#31](https://github.com/devcxl/chatgpt-markdown-exporter/issues/31)、[#28](https://github.com/devcxl/chatgpt-markdown-exporter/issues/28)
- 关联方案：`docs/dev/specs/inline-entry-floating-button.md`

## 背景

页内「导出当前对话」按钮的挂载点依赖 ChatGPT 应用外壳的内部结构。2026-09 与 2026-10 各修一次（`4772819`、`90d7ea5`），每次都是换锚点：

- 主锚点：`[data-app-shell-header-obstacle="true"]` + `ms-auto` + `gap-toolbar-action`
- 次锚点：`#conversation-header-actions`（灰度期老头部）
- 兜底：不寄宿宿主 DOM，改为 `position: fixed` 浮层，按 header 几何计算空位

2026-11-24 在项目会话页实测（`/g/g-p-.../c/<id>`）：`[data-app-shell-header-obstacle="true"]` 数量为 **0**，`#conversation-header-actions` 不存在，按钮实际挂在 `body` 下——即运行的一直是第 3 级兜底。

结论：前两级锚点不是"需要更新"，是**整类信号消失**。继续追新锚点只是把下一次失效推后，而每次失效都以用户看不到按钮的形式发生。

## 决策

### D1：不再寄宿宿主 DOM

按钮永久 `position: fixed` 挂到 `document.body`，自身即最终形态，取消「插槽优先、失败才降级」这条链路。

**否决的替代方案：重新寻找新版头部插入点。** 需要再采一次 DOM 才能知道新结构，且过去三个月同一处已坏两次；而这类信号（CSS Modules 类名、阶段性 `data-*` 属性）本身就没有稳定性承诺。

**否决的替代方案：用 aria-label 做锚点。** 中英文界面标签不同，历史上已因此失效过一次。

### D2：位置与形态固定，不做可配置化

右下角 16px，小胶囊（图标 + 「导出」）。不做拖动、不做滚动淡出、不记忆位置。

理由：任何交互状态都需要持久化，而「导出选项是否持久化」本身还是未定项（见地图 Not yet specified）。为一个可用性边际收益引入 storage 依赖不划算。

### D3：删除观察器与几何避让（Clean Break）

随寄宿策略一起删除：`findToolbarTarget`、`findMountTarget`、`reconcileButtonPosition`、`observeHeader` + `MutationObserver`、`isExternalMutation`、`isElementVisible` / `isVisibleByComputedStyle`、`collectHeaderOccupancy` / `findRightmostGap` / `positionFloating`、`getButtonWidth` / `getButtonHeight`，以及 `TOOLBAR_*`、`LEGACY_HEADER_SELECTOR`、`TITLEBAR_SELECTOR`、`HEADER_INTERACTIVE_SELECTOR`、`FALLBACK_*`、`CURRENT_EXPORT_FALLBACK_ATTR`。

其中观察器的移除是本次最大收益：它原本用于「头部重建后重新收敛」，位置固定后该需求消失，而它自带自激风险（源码注释记录过 1.5s 内 4 次变更、按钮被反复拽回隐藏层的死循环）。

**不做兼容层**：不保留旧函数供将来"可能回归"使用。无人验证的代码只会腐化。

### D4：回归防护改为不变量测试

原计划是「把真机 DOM 片段固化为 fixture 的锚点契约测试」。没有锚点后该方案作废，改为断言与 DOM 无关的不变量：按钮是 `body` 的直接子元素、样式 id 唯一、重复挂载幂等、点击在非 trusted 事件下被忽略。

## 后果

- 正面：页内入口与 ChatGPT 的 DOM 结构彻底解耦，改版不再导致入口消失；`current-export-button.ts` 从 475 行降到百行量级
- 负面：按钮不再与原生工具栏同排，视觉上是一个悬浮控件；在阅读长文时占右下角一小块
- 风险：若将来 ChatGPT 把右下角也占满（如浮动客服/推广条），可能发生遮挡。届时按视觉冲突调整位置即可，不涉及结构依赖
