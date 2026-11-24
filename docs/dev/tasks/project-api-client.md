---
title: 项目侧类型与 API 客户端
id: task-005
parent: 24
issue: null
depends_on: []
assignee: backend
status: ready
---

# task-005: 项目侧类型与 API 客户端

## 目标

新增项目（snorlax gizmo）相关的类型与 API 调用：项目列表、项目内会话列表，并把两种时间格式归一化。依据 `docs/dev/specs/project-export.md` §2、§3、§4.1。

## 范围

| 文件 | 操作 |
|---|---|
| `src/shared/chatgpt-types.ts` | 增加 `ApiProjectSidebar` / `ApiProject` / `ApiProjectConversations`；`ApiConversationItem` 增加 `gizmo_id?: string \| null` |
| `src/entrypoints/chatgpt.content/api.ts` | 新增 `fetchProjects()`、`fetchProjectConversations()`、`toEpochSeconds()` |
| `src/entrypoints/chatgpt.content/api.test.ts` | 追加用例 |

## 实现要点

1. `fetchProjects()`：`GET /gizmos/snorlax/sidebar?owned_only=true&conversations_per_gizmo=0&limit=50`
   - cursor 翻页，`cursor` 为 `null`/缺失即终止
   - 解包 `item.gizmo?.gizmo ?? item.gizmo`（双层嵌套，两种形态都存在）
   - 用 `id.startsWith('g-p-')` 过滤，**不依赖** `gizmo_type`（该字段在会话对象上有 `null` / `"snorlax"` 两种说法）
   - 输出 `{ id, name: display?.name || id, raw }`
2. `fetchProjectConversations(projectId, cursor)`：`GET /gizmos/{id}/conversations?cursor=<cursor ?? 0>&limit=50`
   - `limit` 固定 50（超过 422）
   - 返回项时间为 ISO 字符串 → 用 `toEpochSeconds` 转成 epoch 秒
   - **不得**用 `total` 判断结束
3. `toEpochSeconds(value: number | string): number`：数字直接 `Math.floor`；字符串 `Date.parse/1000`
4. 不得在 `/conversations` 上用 `gizmo_id` 参数（服务端静默忽略）

## 测试（依据 spec §8）

| 用例 | 断言 |
|---|---|
| sidebar 双层嵌套 | `gizmo.gizmo` 与 `gizmo` 两种 fixture 都能解析出 id/name |
| 非项目项 | 不含 `g-p-` 的项被过滤 |
| 空 display | `name` 回退为 id |
| cursor 翻页 | 两页数据合并，末页 `cursor: null` 终止 |
| ISO 时间 | `2025-07-23T17:14:27.231284Z` → 正确 epoch 秒 |
| epoch 时间 | 数字原样（含小数向下取整） |
| limit | 请求 URL 含 `limit=50` |

## 验收

- 单元测试全部离线（fixture + fake fetch），不访问网络
- `pnpm typecheck && pnpm lint && pnpm test` 全绿，覆盖率 ≥ 90%
