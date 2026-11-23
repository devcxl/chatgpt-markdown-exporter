# ChatGPT 项目（snorlax gizmo）侧 API 事实清单

调研对象：issue #26「项目侧 API 能拿到什么（gizmo_id / 项目会话列表）」。

结论只用公开可核对的一手来源：真实登录态下抓过流量的开源工具源码/抓包文档。每条结论后面给链接。
无法从公开来源确认的项明确写「未确认」并给验证方式，**不写推测**。

调研日期：2026-11-24（下文所有 "实测于" 均为来源作者自述的日期，不是本次调研日期）。

---

## 0. 摘要（先看这五条）

| 问题 | 答案 | 置信度 |
|---|---|---|
| 项目列表端点 | `GET /backend-api/gizmos/snorlax/sidebar`，cursor 分页（不是 offset） | 高，多源一致 |
| 项目下会话列表 | 有**专用端点** `GET /backend-api/gizmos/{gizmo_id}/conversations`，cursor 分页。`/conversations?gizmo_id=` **不起过滤作用**（参数被服务端静默忽略） | 高 |
| `gizmo_id` 语义 | 会话项上的 `gizmo_id` 为 `null` / `g-p-<32hex>`（项目）/ `g-<32hex>`（自定义 GPT） | 高 |
| 现有 `/conversations` 是否已带 `gizmo_id` | **带**。字段已在返回项里，无需新增端点就能读到 | 高 |
| 项目会话是否出现在主列表 `/conversations` 里 | **来源互相矛盾，未确认**。必须在实现上按「可能不出现」处理 | 见 §5 |

因此对导出器的实际含义是：**分类是零额外请求的（`gizmo_id` 已在列表项里），但取全项目会话大概率要多发 N+1 个请求（1 次 sidebar + 每项目 1 次分页）**，并且必须按 conversation id 去重。

---

## 1. 项目列表端点

### 1.1 请求

```
GET /backend-api/gizmos/snorlax/sidebar
```

已确认的 query 参数（全部来自真实调用）：

| 参数 | 取值 | 语义 | 来源 |
|---|---|---|---|
| `owned_only` | `true` / `false` | `true` 只返回自己拥有的项目；`false` 额外包含**别人共享给你**的项目 | [brianjlacy `_docs/PROJECTS_FILES_RESEARCH.md` L33-42](https://github.com/brianjlacy/export-chatgpt/blob/main/_docs/PROJECTS_FILES_RESEARCH.md)、[aminearbi `phase0-findings.md` L199](https://github.com/aminearbi/chatgpt-mass-actions/blob/main/docs/phase0-findings.md)、[Octo-Lex `protocol-reference.md`](https://github.com/Octo-Lex/ChatGPT-Web2API/blob/master/docs/protocol-reference.md) |
| `conversations_per_gizmo` | `0` / `5` 等 | 每个项目**内嵌**多少条会话（`0` = 不内嵌）。ChatGPT 自己的前端用 `5` | [brianjlacy L35-37](https://github.com/brianjlacy/export-chatgpt/blob/main/_docs/PROJECTS_FILES_RESEARCH.md)、[aminearbi L216](https://github.com/aminearbi/chatgpt-mass-actions/blob/main/docs/phase0-findings.md) |
| `limit` | 每页条数 | 省略时**只返回 5 条** + cursor；`limit=50` 一次拿回全部 32 个项目 | [grammy-jiang `references/endpoint-discovery.md` L177](https://github.com/grammy-jiang/chatgpt-web-operations/blob/main/references/endpoint-discovery.md)、[`scripts/list_projects.py` L65-91](https://github.com/grammy-jiang/chatgpt-web-operations/blob/main/scripts/list_projects.py) |
| `cursor` | 不透明字符串 | 上一页返回的 `cursor`；`null` 表示最后一页 | 同上 |

ChatGPT 前端自己发的请求（2026-09-19 从网络日志录得）：

```
GET /backend-api/gizmos/snorlax/sidebar?owned_only=true&conversations_per_gizmo=5&limit=20
```

（[grammy-jiang L177](https://github.com/grammy-jiang/chatgpt-web-operations/blob/main/references/endpoint-discovery.md)）

分页语义：**cursor 分页**，不是 `offset`。终止条件是响应里 `cursor` 为 `null`/缺失。注意 `limit` 上限：`gizmos/{id}/conversations` 明确超过 50 就 422（§2.3），但 **sidebar 的 `limit` 上限未确认**（grammy 用 50 成功；Octo-Lex 代码里用 100 但没记录结果）。

### 1.2 响应结构

```jsonc
{
  "items": [
    {
      "gizmo": {                          // 外层 wrapper
        "gizmo": {                        // 真正的项目对象（注意双层嵌套）
          "id": "g-p-69209166eacc81918dc596f8dd06a034",
          "display": { "name": "...", "description": "" },
          "short_url": "g-p-69209166...-qwandery-platform",
          "workspace_id": "cc47585e-b2fe-4e7d-ac6a-ced32852f07b",
          "organization_id": "org-...",
          "created_at": "2025-11-21T16:20:54.917441+00:00",
          "updated_at": "2025-11-21T16:20:55.832364+00:00",
          "last_interacted_at": "2025-10-29T19:25:54.247571+00:00",
          "instructions": "项目说明文本",
          "gizmo_type": "snorlax",
          "num_interactions": 26,
          "memory_enabled": true,
          "memory_scope": "global",
          "context_stuffing_budget": 49152,
          "voice": { "id": "ember" }
        },
        "files": [
          { "id": "67c1...", "file_id": "file-T5e2...", "name": "Document.pdf",
            "type": "application/pdf", "size": 1404959 }
        ],
        "conversations": { "items": [], "cursor": null }   // 仅 conversations_per_gizmo>0 时填充
      }
    }
  ],
  "cursor": "K1JJRDp+RzRVLUFKT0l6aG5sYyt3QkFNQm1Edz09..."   // null = 最后一页
}
```

来源：[brianjlacy `PROJECTS_FILES_RESEARCH.md` L44-90](https://github.com/brianjlacy/export-chatgpt/blob/main/_docs/PROJECTS_FILES_RESEARCH.md)（完整真实响应）、[ericblue/memspan `README.md`](https://github.com/ericblue/memspan/blob/main/export-chatgpt-conversations/README.md)（字段表）、[Octo-Lex `protocol-reference.md`](https://github.com/Octo-Lex/ChatGPT-Web2API/blob/master/docs/protocol-reference.md)（`/gizmos/{id}` 详情里的同一批字段）、[aminearbi L216](https://github.com/aminearbi/chatgpt-mass-actions/blob/main/docs/phase0-findings.md)。

**嵌套必须防御**：多个项目都记录了「有的用户看到 `items[].gizmo.gizmo`，有的源码读 `items[].gizmo`」——

- [pionxzh/chatgpt-exporter `src/api.ts` L383-387](https://github.com/pionxzh/chatgpt-exporter/blob/master/src/api.ts)：`interface ApiGizmo { gizmo: { gizmo: ApiProjectInfo }, conversations: {...} }`
- [netr0m/chatgpt-exporter `chatgpt_client.py` L70-84](https://github.com/netr0m/chatgpt-exporter/blob/main/chatgpt_client.py)：`outer = item["gizmo"]; gizmo = outer["gizmo"]`
- [foxcache `docs/providers/chatgpt.md` L26](https://github.com/itsryanarmani/foxcache/blob/main/docs/providers/chatgpt.md)：「有些来源嵌套成 `gizmo.gizmo`；foxcache 两个都读」
- [TahsinCr webai-provider `discovery.py` L25-32](https://github.com/TahsinCr/webai-provider/blob/main/webaiprovider/providers/chatgpt/discovery.py)：先试 `gizmo` 再回退到 `nested`，并断言 `id` 以 `g-p-` 开头**或** `gizmo_type == "snorlax"`
- [brianjlacy `lib/api.js` L165](https://github.com/brianjlacy/export-chatgpt/blob/main/lib/api.js)：`const g = item.gizmo?.gizmo || item.gizmo`

### 1.3 字段类型与可空性

| 字段 | 类型 | 可空 | 依据 |
|---|---|---|---|
| `items[].gizmo.gizmo.id` | string，`g-p-<32 hex>` | 否 | 多源一致 |
| `...display.name` | string | 否（空项目可能为空串） | [AnrPg `lists.test.ts` L63-73](https://github.com/AnrPg/echoes/blob/main/packages/adapter-chatgpt-api/tests/lists.test.ts) 里有一个只有 `id` 没有 `display` 的项目项，解析结果是 `name: ''` |
| `...display.description` | string | 是（常见空串） | brianjlacy 真实响应 |
| `...short_url` | string | 未确认 | netr0m L81 读它；未见缺省样本 |
| `...workspace_id` | string \| null | **是**。个人账号为 `null` | [eryet `docs/info.md` L432](https://github.com/eryet/chatgpt-chats-timestamp/blob/main/docs/info.md) 的真实 gizmo dump 里 `workspace_id: null` |
| `...organization_id` | string | 未确认 | memspan / pionxzh 类型里有 |
| `...created_at` / `updated_at` / `last_interacted_at` | ISO 8601 字符串（带偏移） | `last_interacted_at` 可空 | brianjlacy / memspan 真实响应；`last_interacted_at` 在 grammy `list_projects.py` 里用 `or updated_at` 兜底，说明可能缺失 |
| `...instructions` | string | 否（可能是空串） | 多源 |
| `...gizmo_type` | string，项目恒为 `"snorlax"` | 未确认 | §4 |
| `...num_interactions` | number | 否 | netr0m L80 默认 0 |
| `...memory_enabled` | boolean | 否 | memspan 字段表、`protocol-reference.md` |
| `...memory_scope` | `"global"` \| `"project_v2"` | 未确认 | `protocol-reference.md` L82 注释：`global` = 共享记忆，`project_v2` = 项目专属记忆 |
| `...context_stuffing_budget` | number（如 `49152`） | 未确认 | `protocol-reference.md` L85 |
| `items[].gizmo.files[]` | `{id, file_id, name, type, size}` | 数组本身可缺 | brianjlacy 真实响应；[AnrPg 测试](https://github.com/AnrPg/echoes/blob/main/packages/adapter-chatgpt-api/tests/lists.test.ts) 里第二个项目没有 `files` |
| `items[].gizmo.conversations` | `{items, cursor}` | `conversations_per_gizmo=0` 时可能缺失或为空 | §2 |
| 顶层 `cursor` | string \| null | **是**，`null` 即末页 | 多源 |

### 1.4 只返回项目，还是混着自定义 GPT？

未确认。`protocol-reference.md` 把该端点的响应标注为「All projects + GPTs」（约 162KB）；[Octo-Lex `backend_client.py` L904-935](https://github.com/Octo-Lex/ChatGPT-Web2API/blob/master/src/chatgpt_web2api/backend_client.py) 的 `list_gpts()` **就是用同一个 sidebar 端点**再在客户端剔除 `gizmo_type == "snorlax"` 得到自定义 GPT 列表——也就是说该项目认为该响应里会混有非项目 gizmo，但它的剔除条件（`gizmo_type === 'snorlax' && memory_scope`）本身看起来可疑。

另一侧，[codex-light `src/gptsData.ts` L76](https://github.com/lusipad/codex-light/blob/master/src/gptsData.ts) 也是「`gizmo_type === 'snorlax'` 就丢弃」，但那是 GPT 发现端点，不是 sidebar。

**实现建议**：不要假设只有项目，按 `id.startsWith('g-p-') || gizmo_type === 'snorlax'` 过滤。[TahsinCr](https://github.com/TahsinCr/webai-provider/blob/main/webaiprovider/providers/chatgpt/discovery.py) 和 [Reclaim-My-Chats](https://github.com/matgir99/Reclaim-My-Chats/blob/main/reclaim/providers/chatgpt.py) 都是这么做的。

---

## 2. 某个项目下的会话列表怎么取

### 2.1 确切答案：有专用端点

```
GET /backend-api/gizmos/{gizmo_id}/conversations?cursor=<cursor>&limit=<n>&owned_only=true
```

这不是推测：至少 8 个独立项目都在真实登录态下调用它，且都记录成功。

| 来源 | 调用形态 |
|---|---|
| [pionxzh `api.ts` L482](https://github.com/pionxzh/chatgpt-exporter/blob/master/src/api.ts) | `/gizmos/:gizmo/conversations?{gizmo,cursor,limit}` |
| [brianjlacy `lib/api.js` L257](https://github.com/brianjlacy/export-chatgpt/blob/main/lib/api.js) | `/gizmos/{id}/conversations?cursor=...` |
| [netr0m `chatgpt_client.py` L156-175](https://github.com/netr0m/chatgpt-exporter/blob/main/chatgpt_client.py) | `/gizmos/{project_id}/conversations?gizmo=...&limit=50&cursor=...` |
| [B4PT0R/codex-backend-sdk `chatgpt.py` L520-530](https://github.com/B4PT0R/codex-backend-sdk/blob/main/codex_backend_sdk/resources/chatgpt.py) | `/gizmos/{project_id}/conversations` + `{cursor, limit, owned_only}` |
| [wingsofovnia/chatgpt-prune `chatgpt_prune.py` L238](https://github.com/wingsofovnia/chatgpt-prune/blob/main/chatgpt_prune.py) | `gizmos/{pid}/conversations`，`cursor=0` 起 |
| [lekandigital `archive.js` L614](https://github.com/lekandigital/chatgpt-claude-backup/blob/main/src/chatgpt/archive/archive.js) | `/gizmos/{id}/conversations?cursor=...&limit=50` |
| [grammy-jiang `list_projects.py` L130-160](https://github.com/grammy-jiang/chatgpt-web-operations/blob/main/scripts/list_projects.py) | `?cursor=0&limit=50` |
| [ZhenHuangLab/inkstone `src/api.ts` L119-127](https://github.com/ZhenHuangLab/inkstone/blob/main/src/api.ts) | `/gizmos/{id}/conversations?cursor=...&limit=...` |

ChatGPT 自己的项目页也是这么加载的：打开 `/g/<short_url>/project` 会调 `gizmos/<id>/conversations?cursor=0`（[grammy-jiang L184-187](https://github.com/grammy-jiang/chatgpt-web-operations/blob/main/references/endpoint-discovery.md)）。

### 2.2 `/conversations?gizmo_id=` 不起过滤作用

这是最关键的一条负面事实，**有实测**：

> `/conversations?...&gizmo_id=<id>` → **静默忽略**该参数，返回全局列表
> `/conversations/search?...&gizmo_id=<id>` → **认这个参数**（同一 query 全局 4 条 → 限定项目后 1 条）

来源：[junghan0611/botschaft `docs/chatgpt-protocol.md` L31-38](https://github.com/junghan0611/botschaft/blob/main/docs/chatgpt-protocol.md)。实测日期 2026-09-10。同一份文档 L21-29 还给了数量对比：三个项目合计 262 条会话，项目外的「全局列表」只有 70 条。

另有一个项目把这条写成了明确的坑：`4444J99/conversation-corpus-engine` 的交接文档里说「`backend-api/conversations?gizmo_id=` 是个陷阱，故意不用」，并改用 `/gizmos/{project_id}/conversations`（[`gh-16-chatgpt-projects-endpoint.md` L9-22](https://github.com/4444J99/conversation-corpus-engine/blob/main/playbooks/handoffs/gh-16-chatgpt-projects-endpoint.md)）。

结论：**不要指望用 `/conversations?gizmo_id=` 过滤**。要么走 §2.1 的专用端点，要么全量拉 `/conversations` 后本地按 `gizmo_id` 过滤（但那样会漏——见 §5）。

### 2.3 响应结构、分页、limit 上限

```jsonc
{
  "items": [
    {
      "id": "68811872-cde4-8003-a4cc-513116c072b0",
      "title": "Terms of Service Draft",
      "create_time": "2025-07-23T17:14:27.231284Z",
      "update_time": "2025-08-17T20:49:57.087149Z",
      "gizmo_id": "g-p-67c1f3e262b88191b3dacb70c6d68354",
      "conversation_template_id": "g-p-67c1f3e262b88191b3dacb70c6d68354",
      "workspace_id": "cc47585e-b2fe-4e7d-ac6a-ced32852f07b",
      "is_archived": false,
      "snippet": "Preview text of the conversation...",
      "owner": { "user_id": "user-...", "user_email": "...", "name": "Brian Lacy" }
    }
  ],
  "cursor": "K1JJRDp+ZVo1eEFKTENNK0FGQkNJQUFBQVFEZz09..."
}
```

来源：[brianjlacy `PROJECTS_FILES_RESEARCH.md` L124-147](https://github.com/brianjlacy/export-chatgpt/blob/main/_docs/PROJECTS_FILES_RESEARCH.md)。

分页与上限（都有实测）：

| 项 | 值 | 来源 |
|---|---|---|
| 起始 cursor | `0`（数字） | pionxzh、brianjlacy、prune、grammy 一致 |
| 后续 cursor | 不透明字符串 | 多源 |
| 终止条件 | `cursor` 为 `null`/缺失 | 多源 |
| `limit` 上限 | **50**；>50 返回 422 `less_than_equal, le: 50` | [aminearbi L217](https://github.com/aminearbi/chatgpt-mass-actions/blob/main/docs/phase0-findings.md)（60 → 422）、[grammy `list_projects.py` L25-28](https://github.com/grammy-jiang/chatgpt-web-operations/blob/main/scripts/list_projects.py)（「since 2026-09-29 answers 422 above 50」）、[foxcache L27](https://github.com/itsryanarmani/foxcache/blob/main/docs/providers/chatgpt.md) |
| 默认 `limit` | 前端项目页用 5 | [aminearbi L200](https://github.com/aminearbi/chatgpt-mass-actions/blob/main/docs/phase0-findings.md) |
| 是否带 `total` | 未确认（pionxzh 的类型里是 `total: null`；netr0m 用例里没读） | — |
| 时间格式 | **ISO 8601 字符串**（与主列表一致，不是 epoch） | aminearbi L217 |
| `mapping` | `null`（列表项不含消息体，要另取 `/conversation/{id}`） | [AnrPg `phase-0.md` L57](https://github.com/AnrPg/echoes/blob/main/docs/phase-0.md) |

项目会话项比主列表多了 `owner`（对象）、`snippet`（预览文本）、`is_starred`（布尔）（[aminearbi L217](https://github.com/aminearbi/chatgpt-mass-actions/blob/main/docs/phase0-findings.md)）。

### 2.4 归档项目会话不在项目列表里

实测（2026-11-14，有真实测试项目）：

> 归档一个项目会话后，它**同时从**主列表、项目会话列表、sidebar 内嵌三处消失；只出现在 `?is_archived=true` 的主列表里，`gizmo_id` 保留。取消归档后三处都回来。

来源：[aminearbi L219](https://github.com/aminearbi/chatgpt-mass-actions/blob/main/docs/phase0-findings.md)。

**含义**：只走 §2.1 拿不全 —— 归档的项目会话必须从 `GET /conversations?is_archived=true` 补，并按 `gizmo_id` 归位。

---

## 3. 抓全项目会话需要多少个请求

按上面的实测拼出来的最小代价：

```
1 次  GET /gizmos/snorlax/sidebar?owned_only=...&conversations_per_gizmo=0&limit=50
      (+ 每 50 个项目再来 1 次 cursor 翻页)
N 次  GET /gizmos/{id}/conversations?cursor=0&limit=50   ← N = 项目数，每个再按 cursor 翻页
1 次  GET /conversations?offset=...&is_archived=true      ← 补归档项目会话
```

也就是说 **1 + N（+ 少量翻页）**。不要试图用 `conversations_per_gizmo=5` 省请求：它只内嵌最近 5 条，不构成完整列表（brianjlacy、aminearbi、pionxzh 最终都会再逐项目分页）。

**必须按 conversation id 去重**：pionxzh 的 `fetchAllConversationsAll` 明确写了「先拉主列表，再逐项目拉，同一个会话在两边都出现时不会导出两次」（[`src/api.ts` L745-770](https://github.com/pionxzh/chatgpt-exporter/blob/master/src/api.ts)）。这条注释本身就说明两边**会**重叠。

---

## 4. `gizmo_id` / `gizmo_type` 的语义

### 4.1 会话项上的 `gizmo_id`

| 值 | 含义 |
|---|---|
| `null` | 普通会话（不属于项目，也不属于自定义 GPT） |
| `g-p-<32 hex>` | 属于某个项目 |
| `g-<32 hex>`（不以 `g-p-` 开头） | 属于某个自定义 GPT |

来源（三者一致）：

- [pionxzh `api.ts` L360-361](https://github.com/pionxzh/chatgpt-exporter/blob/master/src/api.ts)：`/** Non-null when the conversation belongs to a custom GPT or project */ gizmo_id?: string | null`
- [ericblue/memspan `README.md`「Project IDs & Gizmo IDs」](https://github.com/ericblue/memspan/blob/main/export-chatgpt-conversations/README.md)：Project ID = `g-p-{hex}`；Custom GPT ID = `g-{hex}`；「Project IDs always start with `g-p-`」
- [PDP-Connect `connectors/chatgpt/usage.ts` L944-955](https://github.com/PDP-Connect/data-connectors/blob/main/connectors/chatgpt/usage.ts)：注释写「Projects are gizmos whose ids start `g-p-` (**verified live**)」，`gizmoKind()` 用 `gizmoType === 'snorlax' || gizmoId.startsWith('g-p-')` 判项目，`gizmoType === 'gpt' || gizmoId.startsWith('g-')` 判自定义 GPT

### 4.2 `gizmo_type` 的取值

**在会话对象上**（`GET /conversation/{id}` 详情、以及官方数据导出的 `conversations.json`）：

| 值 | 含义 | 来源 |
|---|---|---|
| `null` | 普通会话 | [slyubarskiy 语料统计](https://github.com/slyubarskiy/chatgpt-conversation-extractor/blob/master/src/chatgpt_extractor/gpt_metadata.py) L13-17：扫描 8248 条会话，`'gpt'` 1482 条 / `'snorlax'` 1300 条 / `None` 5466 条 |
| `"gpt"` | 自定义 GPT 会话 | 同上 |
| `"snorlax"` | 项目会话 | 同上；[ryayoung/chatgpt-schema `model/conversation.py` L26](https://github.com/ryayoung/chatgpt-schema/blob/main/model/conversation.py)：`gizmo_type: Lit['gpt', 'snorlax'] | None` |

注意与 memspan README 的一处**冲突**：memspan 的表格写「项目会话 `gizmo_type` 为 `null`」（[README](https://github.com/ericblue/memspan/blob/main/export-chatgpt-conversations/README.md) L460-466）。但同一份 README 的示例 `conversations.json.example` 里项目会话确实是 `"gizmo_type": null`，而 slyubarskiy 的 8248 条语料统计显示有 1300 条是 `"snorlax"`。**以 id 前缀为准**（`g-p-` = 项目），`gizmo_type` 只作辅助信号 —— PDP-Connect 的 `gizmoKind()` 正是这么写的，且注释标明 id 前缀部分是 live-verified。

**在 gizmo 对象上**（sidebar 项目项）：恒为 `"snorlax"`（brianjlacy 真实响应、`protocol-reference.md`、AnrPg 测试 fixture）。

### 4.3 四类会话怎么区分

| 类别 | 判据 | 依据 |
|---|---|---|
| **项目会话** | `gizmo_id` 以 `g-p-` 开头 | §4.1 |
| **自定义 GPT 会话** | `gizmo_id` 非空且不以 `g-p-` 开头（`g-...`） | §4.1 |
| **普通会话** | `gizmo_id === null` | §4.1 |
| **孤儿（项目已删但会话还在）** | `gizmo_id` 以 `g-p-` 开头，**但在 sidebar 项目列表里找不到这个 id** | [memspan `chatgpt_project_conversations.py` L392-408](https://github.com/ericblue/memspan/blob/main/export-chatgpt-conversations/chatgpt_project_conversations.py)：`if gizmo_id.startswith('g-p-')` 且 `gizmo_id not in by_id` → `orphaned_project_conversations`，注释写 "possibly deleted" |

孤儿判定**必须**是「本地差集」：把会话的 `gizmo_id` 集合减去 sidebar 拉到项目 id 集合。没有单独的 orphan 端点。

---

## 5. 现有 `/conversations` 是否已带 `gizmo_id`（关键决策点）

### 5.1 字段本身：**带**

这一条证据非常强，多个独立来源的字段清单里都有 `gizmo_id`：

- [aminearbi `phase0-findings.md` L37](https://github.com/aminearbi/chatgpt-mass-actions/blob/main/docs/phase0-findings.md)：实测 item keys 全表，含 `gizmo_id`、`conversation_template_id`、`workspace_id`
- [PDP-Connect `usage.ts` L21-32](https://github.com/PDP-Connect/data-connectors/blob/main/connectors/chatgpt/usage.ts)：「Probed live on 2026-10-15 … item keys incl. … `conversation_template_id`, `gizmo_id` …」，且其 canary fixture `conversation_list_item` 里 `gizmo_id: null` 是显式字段
- [pionxzh `api.ts` L361](https://github.com/pionxzh/chatgpt-exporter/blob/master/src/api.ts)：`gizmo_id?: string | null`
- [FdezRomero/chatgpt-exporter `src/api/types.ts` L24](https://github.com/FdezRomero/chatgpt-exporter/blob/main/src/api/types.ts)：`gizmo_id: z.string().nullable().optional()`
- [nikolaylosev/ai-chat-exporter `docs/platforms-chatgpt.md` L51](https://github.com/nikolaylosev/ai-chat-exporter/blob/main/docs/platforms-chatgpt.md)：列表项含 `gizmo_id`（custom GPT or project）和 `workspace_id`
- [SimianW/butter 2026-11-18 真实抓包日志](https://github.com/SimianW/butter/blob/main/notes/runs/2026-11-18-live-survey/structure-native.log)：`/backend-api/conversations?...` 的 `itemsKeys` 里明确有 `gizmo_id`、`conversation_template_id`、`workspace_id`
- [minimal 的 TypeScript 定义 osadavc/chatgpt-activity](https://github.com/osadavc/chatgpt-activity/blob/main/src/types/chatgpt_api_response.ts) L9

对导出器的直接含义：**本仓库 `ApiConversationItem` 加一个 `gizmo_id?: string | null` 就能零额外请求地分类项目会话 / 自定义 GPT 会话 / 普通会话**。分类不需要新端点。

### 5.2 但「项目会话是否出现在主列表」——**来源矛盾，未确认**

这是本节唯一不能确定的事，而且两个方向都有真实登录态实测：

**说「不出现在主列表」：**

| 来源 | 实测日期 | 原话 |
|---|---|---|
| [junghan0611/botschaft `chatgpt-protocol.md` L19-29](https://github.com/junghan0611/botschaft/blob/main/docs/chatgpt-protocol.md) | 2026-09-10 | 「The global list contains no project conversations at all. **The two sets do not intersect.**」三个项目合计 262 条，全局列表 70 条，交集 0 |
| [PDP-Connect `usage.ts` L33-36](https://github.com/PDP-Connect/data-connectors/blob/main/connectors/chatgpt/usage.ts) | 2026-10-15 探测 | 「`/conversations` omits project conversations; they are listed from `/gizmos/{id}/conversations?cursor=`」 |
| [matgir99/Reclaim-My-Chats `chatgpt.py` L148-151](https://github.com/matgir99/Reclaim-My-Chats/blob/main/reclaim/providers/chatgpt.py) | — | 「Chats inside Projects are **INVISIBLE** to the main `/conversations` listing - they must be enumerated per project.」（源码注释，来源标注为跟随 pionxzh/chatgpt-exporter） |

**说「出现在主列表」：**

| 来源 | 实测日期 | 原话 |
|---|---|---|
| [aminearbi `phase0-findings.md` L218](https://github.com/aminearbi/chatgpt-mass-actions/blob/main/docs/phase0-findings.md) | **2026-11-14，有真实测试项目** | 「**Project chats are in the plain list** (`hide_snorlax` defaults to false), with `gizmo_id = g-p-…`. `hide_snorlax=true` removes them. `/conversations/batch` returns them too.」 |
| [pionxzh `api.ts` L745-770](https://github.com/pionxzh/chatgpt-exporter/blob/master/src/api.ts) | 现役代码 | 主列表 + 逐项目都拉，**并按 id 去重**（说明会重叠） |
| [grammy-jiang `endpoint-discovery.md` L125](https://github.com/grammy-jiang/chatgpt-web-operations/blob/main/references/endpoint-discovery.md) | 2026-09-19 网络日志 | 前端主列表请求带 `hide_snorlax=true`，「the main list hides project chats **with** `hide_snorlax`」——暗示默认（不带该参数）是包含的；同文件 L182 又说「100 条最近会话里有 2 条在项目内」 |
| [i098/codex-gpui `chatgpt_chats.rs` L23](https://github.com/i098/codex-gpui/blob/main/crates/app/src/chatgpt_chats.rs) | — | 复刻前端请求时显式带 `hide_snorlax=false` |

**第三种说法（可能是真相）**：[wingsofovnia/chatgpt-prune README L76](https://github.com/wingsofovnia/chatgpt-prune/blob/main/README.md) 写「The main list does not include **all** of them」（不是"全都没有"），其实现同时拉主列表、每个项目、归档三路再按 id 合并去重（[`chatgpt_prune.py` L230-255](https://github.com/wingsofovnia/chatgpt-prune/blob/main/chatgpt_prune.py)）。

**结论**：
- 有两种可能：(a) `hide_snorlax` 默认值/账号档位不同导致行为不一致；(b) 2026-09 → 2026-11 之间服务端改了行为。公开来源无法区分。
- **工程上必须按「主列表不可靠」设计**：项目会话一律以 `/gizmos/{id}/conversations` 为权威来源，主列表只用来做一次低成本交叉校验 + 补归档项，最终按 conversation id 去重。
- 这也解释了为什么三个最成熟的实现（pionxzh 2.9k star、brianjlacy、chatgpt-prune）都选择「主列表 + 逐项目 + 归档」三路合并，而不是二选一。

**验证方式（本仓库自己的环境里 5 分钟可做）**：登录 chatgpt.com，在 DevTools Console 里依次跑

```js
const t = (await (await fetch('/api/auth/session')).json()).accessToken
const h = { Authorization: `Bearer ${t}` }
// 1) 主列表里有没有 g-p- 前缀的 gizmo_id
let anyProject = null, off = 0
for (;;) {
  const p = await (await fetch(`/backend-api/conversations?offset=${off}&limit=100&order=updated`, { headers: h })).json()
  const hit = (p.items || []).filter(c => String(c.gizmo_id || '').startsWith('g-p-'))
  if (hit.length) { anyProject = hit[0]; break }
  if (!p.items || p.items.length < 100) break
  off += p.items.length
}
console.log('主列表里的项目会话：', anyProject)
// 2) hide_snorlax=true 时是否消失
const alt = await (await fetch('/backend-api/conversations?offset=0&limit=100&order=updated&hide_snorlax=true', { headers: h })).json()
console.log('hide_snorlax=true 时该项目会话还在吗：',
  alt.items?.some(c => c.id === anyProject?.id))
// 3) 项目端点确实返回它
if (anyProject) {
  const pid = anyProject.gizmo_id
  const pj = await (await fetch(`/backend-api/gizmos/${pid}/conversations?cursor=0&limit=50`, { headers: h })).json()
  console.log('项目端点命中：', pj.items?.some(c => c.id === anyProject.id))
}
```

三种结果的含义：`anyProject` 为 `null` → 主列表不含项目会话（走 pionxzh 路线，必须 N+1）；`anyProject` 命中且 `hide_snorlax=true` 后消失 → 默认包含（可省请求，但仍建议逐项目兜底）；命中但 `hide_snorlax=true` 也不消失 → 与所有已知来源都不符，需要单独记录。

---

## 6. 团队 / 多账号空间（`Chatgpt-Account-Id`）

| 问题 | 结论 | 依据 |
|---|---|---|
| Teams 需要额外 header 吗 | 是。`chatgpt-account-id: <account_id>` 对 Teams workspace 必需，个人账号可选 | [brianjlacy `SPECIFICATION.md` §3.3](https://github.com/brianjlacy/export-chatgpt/blob/main/SPECIFICATION.md)（「Required for Teams workspaces, optional for personal accounts」）；[README](https://github.com/brianjlacy/export-chatgpt/blob/main/README.md) 说该工具「Works with both personal and Teams accounts」并按此实现 |
| 没有该 header 会怎样 | 作者把它列为「No conversations found」的三个可能原因之一（**这是排障提示，不是实测结果**） | brianjlacy README 排障节：「Teams account without `--account-id`」→ "No conversations found" |
| 项目相关端点是否也有同样要求 | **未确认**。没有找到任何来源专门测过「sidebar / gizmos conversations 在 Teams 下的差异」 | — |
| 项目是否按 workspace 隔离 | 有点间接证据：项目对象带 `workspace_id` / `organization_id`（§1.3），个人账号 `workspace_id` 为 `null`。这说明项目确实绑定 workspace，但**未确认** `owned_only` 与 workspace 的交互 | [eryet `docs/info.md` L432](https://github.com/eryet/chatgpt-chats-timestamp/blob/main/docs/info.md) |
| 共享项目 | `owned_only=false` 会包含「别人共享给你的项目」 | [brianjlacy L33-35](https://github.com/brianjlacy/export-chatgpt/blob/main/_docs/PROJECTS_FILES_RESEARCH.md)、[aminearbi L199](https://github.com/aminearbi/chatgpt-mass-actions/blob/main/docs/phase0-findings.md)（转述前端代码：「Web app uses `owned_only=false` here (includes projects shared with the user)」） |

**未确认项的验证方式**：在有 Team workspace 的账号里，用同一 accessToken 分别「带 / 不带」`chatgpt-account-id` 各打一次

```
GET /backend-api/gizmos/snorlax/sidebar?conversations_per_gizmo=0&limit=50
GET /backend-api/gizmos/<g-p-id>/conversations?cursor=0&limit=50
```

比较 200/403/空列表三种结果。若不带 header 时返回的是「个人空间的项目列表」而非报错，说明端点本身不校验 header、只按默认空间解析——这对导出器的含义是：**多空间账号必须显式切换 header 才能拿到对应空间的项目**。

---

## 7. 失败模式速查（给实现用）

| 场景 | 表现 | 应对 | 依据 |
|---|---|---|---|
| `/conversations?gizmo_id=` 过滤 | 静默返回全局列表（不报错） | 别用这个参数 | §2.2 |
| 项目会话 limit > 50 | HTTP 422 `less_than_equal, le: 50` | 固定 50，靠 cursor 翻页 | §2.3 |
| `/conversations` limit > 100 | HTTP 422 `le: 100` | 固定 100 | [aminearbi L34](https://github.com/aminearbi/chatgpt-mass-actions/blob/main/docs/phase0-findings.md) |
| 依赖 `total` 判断结束 | `total` 不是总数：还有下一页时返回 `offset + items.length (+1)` | 用「短页」判定结束（items.length < limit） | 同上 L33 |
| sidebar 不传 `limit` | 只返回 5 条 | 显式传 `limit`（≤50 保守）并翻 cursor | §1.1 |
| 归档项目会话 | 项目端点里没有它 | 从 `?is_archived=true` 补 | §2.4 |
| 项目内嵌会话 `conversations_per_gizmo=5` | 只有最近 5 条 | 不能当完整列表 | §3 |
| 项目已删、会话保留 | `gizmo_id` 以 `g-p-` 开头但不在 sidebar 里 | 本地差集判孤儿 | §4.3 |
| 时间字段 | 列表项是 ISO 字符串，`/conversation/{id}` 详情是 epoch 秒浮点 | 两种都解析 | [aminearbi L37 / L134](https://github.com/aminearbi/chatgpt-mass-actions/blob/main/docs/phase0-findings.md) |
| 无 Bearer 时 | `/conversations` 返回 **200 + 空列表**（不是 401） | 不能把空列表当「没有会话」 | [nikolaylosev L22](https://github.com/nikolaylosev/ai-chat-exporter/blob/main/docs/platforms-chatgpt.md) |

---

## 8. 未确认清单（附验证方法）

| # | 未确认项 | 验证方法 |
|---|---|---|
| 1 | 项目会话是否出现在主 `/conversations`（§5.2 的矛盾） | §5.2 末尾的三段 Console 脚本 |
| 2 | sidebar 的 `limit` 上限是多少 | 试 `limit=50/100/200`，看是否 422（已知 `gizmos/{id}/conversations` 是 50） |
| 3 | sidebar 是否混入非项目 gizmo（自定义 GPT） | 拉一次 sidebar，统计 `items` 里 `id` 不以 `g-p-` 开头的比例 |
| 4 | sidebar 响应有无 `has_more` 字段 | 抓一次响应原文；PDP-Connect 的代码对 `has_more` 做了「有则优先，否则看 cursor」的兼容，说明该字段存在性本身不确定 |
| 5 | `conversations_per_gizmo>0` 时内嵌会话项的完整字段 | 抓 `conversations_per_gizmo=5` 的响应，对比 §2.3 的字段表 |
| 6 | 项目会话端点的 `total` 字段 | 同上 |
| 7 | Teams workspace 下项目端点的行为差异 | §6 的对照实验 |
| 8 | `gizmo_type` 在项目会话上究竟是 `null` 还是 `"snorlax"` | 取一个已知项目的会话，看 `GET /conversation/{id}` 的 `gizmo_type`；两种说法都有来源（§4.2） |
| 9 | `short_url` / `organization_id` 是否可空 | 需要多账号样本 |

---

## 9. 对本仓库的具体含义

1. **`ApiConversationItem` 缺字段**：`src/shared/chatgpt-types.ts` 目前是 `{id, title, create_time, update_time?}`，而真实响应项里有 `gizmo_id`、`conversation_template_id`、`workspace_id`、`is_archived`、`is_starred`、`snippet`、`memory_scope`、`pinned_time` 等（§5.1）。只加 `gizmo_id?: string | null` 就能零请求分类。
2. **现有 `fetchAllConversations` 拿不到项目会话（在 §5.2 的"不出现"假设下）**：`src/entrypoints/chatgpt.content/api.ts` 只打 `/conversations`，没有 gizmo 概念。
3. **需要新增的端点**：`/gizmos/snorlax/sidebar`（列表）+ `/gizmos/{id}/conversations`（每项目分页），两者共用现有 `fetchApi` 的 Cookie + Bearer + `Chatgpt-Account-Id` 头即可，无需改认证。
4. **成本**：1 + N 次请求（N = 项目数），加上归档列表 1 次。对"只导出当前会话"的现有主流程无影响，可作为可选的「按项目导出」路径。
5. **不要**试图用 `?gizmo_id=` 在 `/conversations` 上过滤（§2.2）。

---

## 10. 来源清单

| 仓库 | 性质 | 关键文件 |
|---|---|---|
| [pionxzh/chatgpt-exporter](https://github.com/pionxzh/chatgpt-exporter)（★2902，2026-11-23 活跃） | 浏览器扩展，生产代码 | [`src/api.ts`](https://github.com/pionxzh/chatgpt-exporter/blob/master/src/api.ts) |
| [brianjlacy/export-chatgpt](https://github.com/brianjlacy/export-chatgpt)（★130，宣称支持 Teams） | Node CLI，含完整真实响应样例 | [`_docs/PROJECTS_FILES_RESEARCH.md`](https://github.com/brianjlacy/export-chatgpt/blob/main/_docs/PROJECTS_FILES_RESEARCH.md)、[`SPECIFICATION.md`](https://github.com/brianjlacy/export-chatgpt/blob/main/SPECIFICATION.md)、[`lib/api.js`](https://github.com/brianjlacy/export-chatgpt/blob/main/lib/api.js) |
| [aminearbi/chatgpt-mass-actions](https://github.com/aminearbi/chatgpt-mass-actions) | 有真实测试项目的逐项实测记录（2026-11-14） | [`docs/phase0-findings.md`](https://github.com/aminearbi/chatgpt-mass-actions/blob/main/docs/phase0-findings.md) |
| [junghan0611/botschaft](https://github.com/junghan0611/botschaft) | 逐条实测的协议文档（2026-09-10） | [`docs/chatgpt-protocol.md`](https://github.com/junghan0611/botschaft/blob/main/docs/chatgpt-protocol.md) |
| [PDP-Connect/data-connectors](https://github.com/PDP-Connect/data-connectors)（2026-11-23 活跃） | 现场探测 + 可核对 fixture | [`connectors/chatgpt/usage.ts`](https://github.com/PDP-Connect/data-connectors/blob/main/connectors/chatgpt/usage.ts)、[`__fixtures__/usage-account-endpoints-canary.json`](https://github.com/PDP-Connect/data-connectors/blob/main/connectors/chatgpt/__fixtures__/usage-account-endpoints-canary.json) |
| [grammy-jiang/chatgpt-web-operations](https://github.com/grammy-jiang/chatgpt-web-operations) | 从浏览器网络日志录的端点表 | [`references/endpoint-discovery.md`](https://github.com/grammy-jiang/chatgpt-web-operations/blob/main/references/endpoint-discovery.md)、[`scripts/list_projects.py`](https://github.com/grammy-jiang/chatgpt-web-operations/blob/main/scripts/list_projects.py) |
| [ericblue/memspan](https://github.com/ericblue/memspan) | 项目↔会话关联 + 孤儿分类 | [`export-chatgpt-conversations/README.md`](https://github.com/ericblue/memspan/blob/main/export-chatgpt-conversations/README.md)、[`chatgpt_project_conversations.py`](https://github.com/ericblue/memspan/blob/main/export-chatgpt-conversations/chatgpt_project_conversations.py) |
| [wingsofovnia/chatgpt-prune](https://github.com/wingsofovnia/chatgpt-prune) | 三路合并去重的实际实现 | [`chatgpt_prune.py`](https://github.com/wingsofovnia/chatgpt-prune/blob/main/chatgpt_prune.py) |
| [netr0m/chatgpt-exporter](https://github.com/netr0m/chatgpt-exporter) | 简洁参考实现 | [`chatgpt_client.py`](https://github.com/netr0m/chatgpt-exporter/blob/main/chatgpt_client.py) |
| [Octo-Lex/ChatGPT-Web2API](https://github.com/Octo-Lex/ChatGPT-Web2API) | 协议参考 + gizmo 结构 | [`docs/protocol-reference.md`](https://github.com/Octo-Lex/ChatGPT-Web2API/blob/master/docs/protocol-reference.md)、[`backend_client.py`](https://github.com/Octo-Lex/ChatGPT-Web2API/blob/master/src/chatgpt_web2api/backend_client.py) |
| [B4PT0R/codex-backend-sdk](https://github.com/B4PT0R/codex-backend-sdk) | 类型化的 endpoint 封装 | [`codex_backend_sdk/resources/chatgpt.py`](https://github.com/B4PT0R/codex-backend-sdk/blob/main/codex_backend_sdk/resources/chatgpt.py) |
| [slyubarskiy/chatgpt-conversation-extractor](https://github.com/slyubarskiy/chatgpt-conversation-extractor) | `gizmo_type` 三值语义 + 8248 条语料统计 | [`src/chatgpt_extractor/gpt_metadata.py`](https://github.com/slyubarskiy/chatgpt-conversation-extractor/blob/master/src/chatgpt_extractor/gpt_metadata.py) |
| [SimianW/butter](https://github.com/SimianW/butter) | 2026-11-18 的真实端点字段快照 | [`notes/runs/2026-11-18-live-survey/structure-native.log`](https://github.com/SimianW/butter/blob/main/notes/runs/2026-11-18-live-survey/structure-native.log) |
| [ZhenHuangLab/inkstone](https://github.com/ZhenHuangLab/inkstone)（★61） | 项目导出的中文实现 | [`src/api.ts`](https://github.com/ZhenHuangLab/inkstone/blob/main/src/api.ts) |
| [AnrPg/echoes](https://github.com/AnrPg/echoes) | 含 sidebar 结构的单元测试 fixture | [`docs/phase-0.md`](https://github.com/AnrPg/echoes/blob/main/docs/phase-0.md)、[`packages/adapter-chatgpt-api/tests/lists.test.ts`](https://github.com/AnrPg/echoes/blob/main/packages/adapter-chatgpt-api/tests/lists.test.ts) |
