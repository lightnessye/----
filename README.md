# 破冰局 · 聚会热场游戏主持人

一台大屏当主持，人手一部手机当手柄。开房间 → 扫码进房 → 选游戏 → 开玩，不用注册、不用装 App，手机浏览器打开就能玩。

## 特性

- **大屏 + 手机双端**：大屏（主持人视角）展示题目、倒计时与结算；手机是每个人的私密输入端，身份、词语只发到本人手机上。
- **9 款破冰游戏**：从 30 秒冷场急救到 45 分钟狼人杀，覆盖陌生人破冰、熟人互坑、肢体热场。
- **按场合推荐**：输入人数、时长、氛围（爆笑 / 走心 / 烧脑 / 竞技）、熟悉度、社恐程度、有没有手机，推荐引擎给出排序和可解释的推荐理由。
- **双裁判模式**：「AI 裁判」是内置规则引擎（计时、报轮次、统计、结算、主持文案），不接任何外部模型、零成本离线可用；多数游戏也可切换成人类裁判手动录入。
- **房间即开即用**：4 位房号 + 二维码扫码加入，房主和玩家各有独立 token，3 小时无活动自动清理。

## 游戏一览

| 游戏 | 人数 | 时长 | 裁判 |
| --- | --- | --- | --- |
| 🕵️ 谁是卧底 | 4–12 | 8–20 分钟 | AI / 人类 |
| 🎭 两真一假 | 3–16 | 6–18 分钟 | AI / 人类 |
| 🍲 海龟汤 | 3–15 | 10–25 分钟 | AI / 人类 |
| 💣 数字炸弹 | 3–20 | 3–12 分钟 | 仅 AI |
| 7️⃣ 逢七过 | 4–24 | 3–10 分钟 | AI / 人类 |
| ✍️ 故事接龙 | 3–15 | 8–20 分钟 | 仅 AI |
| 🙅 我有你没有 | 3–16 | 6–15 分钟 | AI / 人类 |
| 🤸 你比我猜 | 4–20 | 5–15 分钟 | AI / 人类 |
| 🐺 狼人杀 | 6–12 | 15–45 分钟 | 仅 AI（6 / 9 / 12 人三种板子，夜晚行动自动结算） |

游戏元数据（人数、时长、推荐权重、规则文案）统一维护在 `src/shared/games.ts`，推荐引擎和两端 UI 都以它为唯一数据源。

## 快速开始

环境要求：**Node.js ≥ 20**。

### Windows 一键启动（推荐聚会用）

双击 `启动游戏.bat`：首次运行自动安装依赖并构建，之后启动服务、打开浏览器，并在窗口里打印局域网地址。手机和电脑连同一 Wi-Fi，扫大屏上的二维码即可加入。

### 手动启动

```bash
npm install

# 聚会模式：构建后单端口跑全部（大屏 + 手机 + API）
npm run build
npm start
# 本机访问 http://localhost:8787，终端会打印局域网地址（手机用这个）

# 开发模式：Vite 热更新 + tsx 直跑服务端
npm run dev
# 本机打开 http://localhost:5173（API 在 8787，由 Vite 代理）
```

端口可用环境变量 `PORT` 覆盖（默认 8787）。

## 测试

```bash
npm run typecheck        # TypeScript 全量类型检查

# 无头端到端：走真实 HTTP 接口把各款游戏自动跑完一局，并检查答案是否泄露给不该看到的玩家
# 需要服务已在 8787 端口运行（npm start 或 npm run dev 均可）
node scripts/e2e.mjs             # 全部游戏
node scripts/e2e.mjs spy soup    # 只跑指定游戏
BASE=http://localhost:9000 node scripts/e2e.mjs   # 指向其他地址
```

## 部署

### Docker / Render

仓库自带多阶段 `Dockerfile`（构建层跑 typecheck + vite + esbuild，运行层只留生产依赖和 dist）和 `render.yaml`（Render 免费套餐，健康检查 `/api/health`）。其他支持 Docker 的平台同理：

```bash
docker build -t icebreaker-party .
docker run -p 8787:8787 icebreaker-party
```

### Qoder Sites

`.破冰局.qoder.site` 是站点描述文件，`functions/` 是 Sites Edge Function（Deno）入口。同一套游戏逻辑通过 `functions/application.mjs` 跑在平台数据库上，用 `seq` 乐观锁处理并发写。本地用 `npm run build && vite preview`（4173 端口）可以验证 Sites 形态的产物。

## 项目结构

```
├── src/
│   ├── client/          # React 前端：大屏(host)、手机(p)、观战(watch)、加入(join)
│   │   ├── games/       # 各游戏的客户端交互模型
│   │   ├── hooks/       # useRoom 轮询同步、useShareBase 分享地址
│   │   ├── ui/          # 舞台、聊天、裁判台、玩家输入等组件
│   │   └── views/       # 首页 / 游戏库 / 主持 / 加入 / 手机 五个页面
│   ├── shared/          # 双端共用的纯 TypeScript
│   │   ├── engine/      # 9 款游戏的状态机（spy/twos/soup/bomb/seven/story/never/mime/werewolf）
│   │   ├── games.ts     # 游戏元数据唯一数据源
│   │   ├── recommend.ts # 场合 → 推荐排序 + 理由
│   │   ├── judge.ts     # 本地裁判文案引擎（语料池 + 变量填充，无外部模型）
│   │   └── types.ts     # 房间 / 玩家 / 阶段等类型
├── server/              # Express：房间 API、400ms tick 推进游戏、内存存储
├── functions/           # Qoder Sites Edge Function 入口与平台数据库适配
├── scripts/             # dev / open(一键启动) / e2e / render / build-function
├── index.html           # SPA 入口，构建时为每个路由生成真实 html
└── vite.config.ts       # 路由页插件 + 开发/预览代理
```

## 架构说明

- **服务端权威**：所有游戏状态存在服务端，客户端每 1.2 秒轮询房间视图；玩家只能看到自己该看到的字段（词语、身份、汤底按 token 过滤）。
- **游戏引擎纯函数化**：`src/shared/engine/` 不依赖 DOM 也不依赖 Node，Express 和 Sites Edge Function 复用同一套状态机。
- **存储可插拔**：`server/store.ts` 定义 `RoomStore` 接口；本机 Express 用进程内 Map，Sites 部署用平台数据库（读时记 `seq`，写回乐观并发，冲突重读重试）。
- **前端零路由依赖**：`src/client/route.ts` 用 pathname + query 分发；构建时为 `/games` `/join` `/host` `/p` `/watch` 各生成一份真实 html，适配无目录索引的静态托管。

## API 速览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查与房间数 |
| GET | `/api/meta` | 计算访客可访问的分享 base（本机自动换局域网 IP） |
| POST | `/api/rooms` | 建房（游戏 + 场合画像） |
| POST | `/api/join` | 加入房间，返回玩家 token |
| GET | `/api/rooms/:code` | 房间视图（按 token 过滤私密字段，`?watch=1` 观战） |
| POST | `/api/rooms/:code/action` | 玩家提交行动 / 输入 |
| POST | `/api/rooms/:code/next` | 主持人推进阶段 |
| POST | `/api/rooms/:code/configure` | 切换裁判模式 / 裁判人 / 狼人杀板子 |

## 技术栈

React 18 · Vite 5 · TypeScript · Express 4 · esbuild · qrcode（房间二维码）