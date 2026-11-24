# 技术方案：按项目导出

- 状态：待实现
- 关联 issue： [#24](https://github.com/devcxl/chatgpt-markdown-exporter/issues/24)（feature request）、[#29](https://github.com/devcxl/chatgpt-markdown-exporter/issues/29)（产品语义）、[#26](https://github.com/devcxl/chatgpt-markdown-exporter/issues/26)（API 事实）
- 调研：`research/project-api` 分支的 `docs/research/project-gizmo-api.md`
- 涉及模块：`src/entrypoints/chatgpt.content/api.ts`、`src/entrypoints/popup/`、`src/entrypoints/background.ts`、`src/shared/{chatgpt-types,messages,files}.ts`、`src/markdown/conversation-to-markdown.ts`

## 1. 目标

弹窗新增「项目」维度：可浏览某个 ChatGPT Project 下的会话，并把整个项目导出为一个 ZIP，内部按项目名分目录。

## 2. 已确认的 API 事实

| 项 | 结论 |
|---|---|
| 项目列表 | `GET /backend-api/gizmos/snorlax/sidebar?owned_only=true&conversations_per_gizmo=0&limit=50`，**cursor 分页**（不传 `limit` 只返 5 条） |
| 项目内会话 | `GET /backend-api/gizmos/{gizmo_id}/conversations?cursor=0&limit=50`（`limit` 上限 50，超出 422） |
| 过滤参数 | `/conversations?gizmo_id=` **被服务端静默忽略**，不得使用 |
| 会话分类 | 现有 `/conversations` 列表项已带 `gizmo_id`：`null` 普通 / `g-p-` 项目 / `g-` 自定义 GPT |
| 时间格式 | 主列表 `create_time` 是 **epoch 秒（数字）**；项目会话列表是 **ISO 8601 字符串** —— 必须归一化 |
| 归档会话 | 三处都不可见，只能从 `/conversations?is_archived=true` 拿。本次**不导出归档会话** |
| 认证 | 复用现有 `fetchApi`（Cookie + Bearer + 可选 `Chatgpt-Account-Id`），无需改动 |

### 2.1 项目列表响应（双层嵌套，必须防御）

```ts
// 真实结构：items[].gizmo.gizmo 才是项目对象；部分账号/来源为 items[].gizmo
type RawSidebarItem = { gizmo?: { gizmo?: RawProject; files?: unknown[]; conversations?: { items: unknown[]; cursor: string | null } } };
type RawProject = {
  id: string;                       // "g-p-<32hex>"
  display?: { name?: string; description?: string };
  instructions?: string;
  gizmo_type?: string;              // "snorlax"
  num_interactions?: number;
  memory_enabled?: boolean;
  memory_scope?: string;
  created_at?: string; updated_at?: string; last_interacted_at?: string | null;
  workspace_id?: string | null; organization_id?: string;
};

type ApiProjectSidebar = { items: RawSidebarItem[]; cursor?: string | null };
```

解包规则：`item.gizmo?.gizmo ?? item.gizmo`；再用 `id.startsWith('g-p-')` 过滤（不依赖 `gizmo_type`，因为会话对象上该字段存在 `null` / `"snorlax"` 两种说法）。

### 2.2 项目会话响应

```ts
type ApiProjectConversations = {
  items: Array<{
    id: string; title: string;
    create_time: string; update_time: string;   // ISO 8601
    gizmo_id?: string | null; is_archived?: boolean;
    snippet?: string; is_starred?: boolean;
  }>;
  cursor?: string | null;
};
```

## 3. 领域模型

```
Project              = { id, name }                                  // 不保留 raw，UI 不需要
ConversationListItem = { id, title, create_time, update_time?, gizmo_id }  // 复用 ApiConversationItem
```

- 项目名 `display.name` 为空 → 回退项目 id
- 归一化函数 `toEpochSeconds(value: number | string | null): number`：数字向下取整，字符串走 `Date.parse / 1000`，**解析失败返回 0**（不把 NaN 传下去）
- 缺 `update_time` 时**不补字段**（补 0 会显示成 1970）；缺 `gizmo_id` 时补 `null`
- 现有 `ConversationItem`（popup）字段不变，只保证 `create_time` / `update_time` 始终是 epoch 秒
- 有意不引入 `raw`：`num_interactions` / `instructions` 这次都不用，带原始对象只会让边界变糊

## 4. 接口与消息

### 4.1 content 侧新增

```ts
// api.ts
export async function fetchProjects(): Promise<Project[]>;                 // sidebar 全量翻页（cursor=0 起），解包 + 过滤 g-p- + 按 id 去重
export async function fetchProjectConversations(projectId: string, cursor = 0): Promise<ProjectConversationPage>;

type ProjectConversationPage = { items: ApiConversationItem[]; cursor: string | null };
```

- `Project` 定义在 `shared/chatgpt-types.ts`（跨 context 共享），不在 `api.ts` 里另建一份
- `fetchProjectConversations` 的 `limit` 固定 50；**不得用 `total` 判断结束**
- 末页判定：`cursor` 为 `null`/缺失/空串（统一归一为 `null`）
- `fetchProjects` 翻页需带**重复 cursor 防护**：服务端若原样下发同一个 cursor，直接终止，否则会无限请求同一页

### 4.2 消息

```ts
type RequestProjectListMessage = { type: 'REQUEST_PROJECT_LIST' };

// 现有列表请求增加可选项目维度
type RequestConversationListMessage = {
  type: 'REQUEST_CONVERSATION_LIST';
  offset?: number; limit?: number;
  projectId?: string;        // 存在则走 /gizmos/{id}/conversations，offset 不适用，改由 cursor 翻页
  cursor?: string | number;
};

// 导出请求增加项目上下文
type RequestExportConversationsMessage = {
  type: 'REQUEST_EXPORT_CONVERSATIONS';
  chatIds: string[];
  includeFrontmatter: boolean; includeTimestamps: boolean; timestamp24h: boolean;
  fenceMessages: boolean;
  project?: { id: string; name: string };   // 存在则产物按项目分目录并写 frontmatter
};
```

响应类型 `ConversationListResponse` 增加 `projects?: Project[]`、`cursor?: string | null`。

## 5. 产物

### 5.1 目录与命名

```
chatgpt-project-<项目名>-<时间戳>.zip
└── <项目名>/
    ├── 2026-11-24-<会话标题>.md
    └── assets/<uuid>.png
```

- 项目名与标题均过 `sanitize-filename`；项目名为空回退项目 id
- 图片前缀由 `'ChatGPT/'` 改为 `'<项目名>/'`，Markdown 中的引用保持相对路径（`images.ts` 已保证「.md 与 assets/ 同层」）
- 新增 `buildProjectMarkdownFilename(project, title, chatId, date)`、`buildProjectZipFilename(project, date)`；两者都接收 `Project = { id, name }` 而不是裸字符串项目名 —— id 与 name 永远成对出现，且**名为空时要回退 id**，只传 name 做不到
- 目录名与 ZIP 名共用同一个 `projectDirectoryName()`（`sanitize-filename` + 空名回退），避免两处各写一遍
- 现有 `buildMarkdownFilename` / `buildZipFilename` 不动（普通批量导出仍用）

### 5.2 上限

| 常量 | 现值 | 新值 | 理由 |
|---|---|---|---|
| `MAX_ZIP_FILES` | 100 | **500** | 100 在文本为主的场景无依据；项目常有 100–300 个会话 |
| `MAX_ZIP_TOTAL_BYTES` | 12MB | 12MB（不变） | 这是内存与浏览器的实质约束，图片是主要消耗者 |
| `MAX_TEXT_BYTES`（单文件） | 8MB | 不变 | — |

超字节上限沿用现有 `background.contentTooLarge`（`导出内容总量过大，请缩小批量范围后重试`）——这条文案对普通批量导出与项目导出都成立，不为项目单独加分支。**不做自动分卷**：连续多次触发下载会被浏览器拦截。

### 5.3 frontmatter

项目导出时追加两个字段（`yamlString` 转义）：

```yaml
project: "我的研究项目"
project_id: "g-p-6a66f8f99fe8819193edea727f5bd14b"
```

通过 `MarkdownMetadata` 增加可选 `project?: { id: string; name: string }` 传入；非项目导出不出现这两行，保证现有输出逐字节不变。

## 6. 弹窗交互

```
[项目 ▾ 全部会话 / 项目 A / 项目 B]        ← 新增下拉
[包含 frontmatter] [包含时间] [24 小时制] [围栏代码块]
[全选] [清空]                    [刷新]
┌──────────────────────────┐
│ ☑ 会话 1                  │  ← 选定项目时只显示该项目会话
│ ☑ 会话 2                  │
└──────────────────────────┘
[导出所选为 ZIP]      ← 选定项目时文案改为「导出整个项目（N 个会话）」
```

- 下拉首项「全部会话」= 现有行为
- 选定项目后：列表改为该项目的会话（cursor 翻页替代 offset 翻页），「全选」作用于当前项目，导出按钮一键导出全部
- **「导出整个项目」= 导出该项目全部会话，与勾选无关**：点击时先把剩余页拉完（cursor 循环），再一次性提交；只导出「已滚动加载的那部分」会让产物看起来完整其实缺页
- 还有未加载的页时，按钮文案用「导出整个项目」（不报数量）；全部加载完才显示「导出整个项目（N 个会话）」
- 切换项目或切回「全部会话」时，**在飞行的旧请求结果必须丢弃**（请求代次校验），否则会出现「列表是旧项目、projectId 是新项目」的串台
- **不支持项目与散会话混选**：切回「全部会话」会清空选择
- 项目列表加载失败（401/403/网络）时：下拉只剩「全部会话」，状态栏给出可读错误，不影响现有批量导出

## 7. 边界与失败模式

| 情况 | 处理 |
|---|---|
| 项目名相同 | ZIP 内目录同名是各自独立的导出，不会同时出现在一个 ZIP 里；同一项目内同名标题由 `dedupeNamedFiles` 追加 `(2)` |
| 项目名含非法字符 | `sanitize-filename` + `/` 分段处理（`sanitizeDownloadPath` 已有） |
| 项目里只有一个会话 | 仍打包为 ZIP：`buildDownloadMessage` 的「单文件拍平成 .md」对项目导出停用，否则 `<项目名>/` 目录与 ZIP 名全部丢失 |
| 项目名为空 | 回退项目 id |
| 归档项目会话 | 不导出（项目端点里本来就没有） |
| 孤儿（`g-p-` 但项目已删） | 不出现在项目下拉；如出现在「全部会话」按普通会话导出 |
| 自定义 GPT 会话（`g-` 非 `g-p-`） | 按普通会话处理 |
| 项目会话 `limit > 50` | 固定 50，靠 cursor 翻页 |
| 无 Bearer 时列表返回 200 + 空数组 | 不能把空列表当「没有会话」；沿用现有错误路径 |
| 单会话详情仍是 `/conversation/{id}` | 与项目无关，不改变现有导出链路 |

## 8. 测试

| 模块 | 用例 |
|---|---|
| `api.ts` | sidebar 双层嵌套解包；`g-p-` 过滤；cursor 翻页终止；项目会话 ISO → epoch 归一化；`limit` 固定 50 |
| `files.ts` | 项目目录与 ZIP 名；非法字符；空项目名回退 id；同名标题去重 |
| `conversation-to-markdown.ts` | `project` / `project_id` 进出 frontmatter；缺省时不出现 |
| `messages.ts` | 新消息类型的类型守卫；`project` / `fenceMessages` 透传 |
| `popup/index.test.ts` | 项目下拉渲染；切项目后列表请求带 `projectId`；「全选」只作用于当前项目；切回全部会话清空选择 |
| `background.test.ts` | 新增消息路由；500 文件上限的边界 |

全部用 fake-browser 与固定 fixture，不访问网络。

## 9. 验收

- 在真实账号上选一个项目 → 列表显示其会话 → 「导出整个项目」产出 ZIP，目录与文件名符合 §5.1
- 打开任一 `.md`，frontmatter 含 `project` / `project_id`，正文与单会话导出一致
- 切回「全部会话」后现有批量导出行为无变化
- `pnpm typecheck && pnpm lint && pnpm test` 全绿，覆盖率 ≥ 90%

## 10. 明确不做

- 导出归档会话、项目 instructions / memory / 项目文件
- 项目与会话混选
- 自动分卷 ZIP
- `fetchAllConversations` 的 100 条上限调整（独立问题）
