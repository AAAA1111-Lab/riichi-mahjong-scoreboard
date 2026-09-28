# 多房间功能变更位置记录（供最终合并使用）

- **工作副本**：`C:\Users\Gjy_2\Documents\Project-multi-room`（独立副本，未推送任何远程；本地 git 已提交）
- **基线**：扁平化重构后的 main（副本建立时与原项目 `Project` 完全一致）
- **功能开关**：`--multi-room` / `ENABLE_MULTI_ROOM=true`；缺省关闭 = 与现状 server 分支等价。`start-server.bat/.sh` 已默认携带 `--multi-room`
- **验证结果**：`test-modules.js` 48/48（回归）；`test-multi-room.js` 40/40；`test-multi-room-deep.js` 32/32（深度）；前端 `tsc -b` + `vite build` 通过

## 第十一轮（2026-09-13）：修复成员卡在"校验房间状态" + 房主必须选中空闲席位

### 问题（需求方实测）

1. **开始对局后成员有概率卡在"正在校验房间状态"**：socket 监听器（空依赖挂载）闭包捕获了**挂载时**的 `activeRoomId`——经大厅导航进房的成员，`game-started` 时从过期的缓存键读取席位失败，`mySeatId` 无法置位，永远卡在等待层（直连 URL 进房的成员闭包正确，故"有概率"）。
2. **房主必须选中空闲座位才可开启对局**：房主选座后若席位被成员占用，开始对局需被阻止并引导换座。

### 变更

| 文件 | 变更 |
|---|---|
| `App.tsx` | 新增 `activeRoomIdRef` 镜像当前房间号；`claim-seat-result` / `game-started` / `force-clear-seats` / `room-disbanded` / `kicked` 监听器全部改读 ref——从正确缓存键读写席位；导航/回大厅/换房同步更新 ref |
| `ServerClaimSeatStage.tsx` | 新增自动改选 effect：所选席位被他人确认占用时自动改选首个空闲席位；房主"开始对局"按钮在所选席位被占时禁用并提示 |
| `server.js` start-game | `seatId` 被占用时明确拒绝（`所选席位已被占用`），不再静默回退；未传 seatId 仍回退首个空闲席（兼容旧客户端） |
| `scripts/test-multi-room-deep.js` | D8 断言改为"房主 seatId 偏好入座席位 1" |

### 验证

40/40 + 32/32 + 48/48 全绿；两版前端产物重建。

## 第十轮（2026-09-13）：分享链接带房间号 + 未准备成员不阻塞开局

### 需求（需求方）

1. 分享界面的二维码/URL 使用前端获取且**带房间号**确保可用；
2. 成员**访问并准备**才视为加入房间；存在访问了 URL 但**未准备**的成员时**也可开始对局**——开始后向未准备玩家发送既有"对局已开始"弹窗并**移回大厅**。

### 变更

| 文件 | 变更 |
|---|---|
| `App.tsx` | 新增 `getShareUrl()`：server 版分享链接 = 前端 origin + `/房间号`（二维码、文本链接、复制按钮统一使用）；LAN 版保持原逻辑 |
| `server.js` start-game | **移除"未准备成员阻塞开始"**：开始时遍历对局频道内未准备成员的 socket → `leave` + 下发 `game-already-started`（弹窗）+ 移出成员表 |
| `ServerClaimSeatStage.tsx` | 房主"开始对局"按钮**始终可用**（不再按 allConfirmed 禁用） |
| `scripts/test-multi-room-deep.js` | D8 重写：未准备成员不阻塞开局 + 收到弹窗被移回；房主 seatId 偏好入座断言 |

### 语义

- 成员身份以"已准备"为准：仅访问 URL 未准备的成员在开局时被移回大厅（收到弹窗），不算对局成员；
- 房主随时可开局（哪怕 0 名成员已准备，房主单人也允许——与 LAN 单人先开局体验一致）；
- 已准备成员不受影响，正常同步进入对局。


## 第八轮补充（2026-09-13）：消除选座阶段闪现 + 断线弹窗次序

### 问题（需求方实测）

URL 访问已锁房间时：先短暂闪现 ServerClaimSeatStage → 再闪"与服务器连接断开"全屏弹窗 → 最后才弹"对局已开始"。

### 根因与修复

| 项 | 说明 |
|---|---|
| 选座界面闪现 | join-room 校验完成前客户端就渲染了选座阶段（`mySeatId===null` 即渲染）。修复：server 模式带房间号的页面在 **lobby 状态未到达** 或 **房间已锁定** 时渲染"正在校验房间状态"等待层，选座界面在确认可进入前不挂载 |
| 断线弹窗次序 | 该弹窗由 `!connected` 驱动（App.tsx:2537）——连接建立前/瞬断期间会闪现；等底层/连接完成后即被"对局已开始"弹窗取代。lobby 门禁使选座界面不再参与该时序，弹窗次序变为：等待层 → 对局已开始弹窗 → 回大厅 |
| 测试 | 40/40 + 31/31 + 48/48 保持全绿；两版前端产物已重建 |



## 第八轮（2026-09-13）：修复房主无法选座

### 问题（需求方实测，稳定复现）

上一轮在 `handleSeatClick` 里对房主加了 `if (isHost) return`——把房主**选座**也一并禁掉了（原意只禁"准备"步骤）。

### 修复

| 文件 | 变更 |
|---|---|
| `ServerClaimSeatStage.tsx` | 移除房主选座禁用——房主可正常点选席位/随机选座（仍无"准备"步骤）；"开始对局"按钮显示将入座的风位；`onStartGame` 载荷增加 `seatId` |
| `StageResolver.tsx` / `App.tsx` | `onStartGame(playerName, seatId?)` 签名透传 |
| `server.js` start-game | 接收 `seatId`：**优先房主选中席位**（未被占时），被占/未传则回退首个空闲席位；全满仍拒绝 |



## 第七轮（2026-09-13）：锁房完善——URL 访问已开始对局不返回选座界面

### 需求（需求方）

通过 URL 请求**已开始**的对局时，不得返回 ServerClaimSeatStage 选座界面，改为返回既有的"对局已开始"弹窗样式。

### 变更

| 文件 | 变更 |
|---|---|
| `server.js` join-room | 对局已开始（`room.started`）时：白名单成员按 token 自动重绑进对局（既有）；**其余（未准备成员/陌生 token）**→ `socket.leave(room)` 退出对局频道 + 向该 socket 下发 **`game-already-started`**（不再返回任何选座相关状态） |
| `App.tsx` | 新增 `game-already-started` 监听：用现有 `showAlert` 弹窗样式提示 + `handleBackToPortal()` 立即返回对局大厅；cleanup 补 off |

### 语义

- 已开始房间成员刷新：token 重绑 → `gameStarted=true` 直接回对局（不变）；
- 其他任何 URL 访问（陌生设备/未准备成员/第二标签页新会话）：服务端不下发选座界面所需状态，前端弹"对局已开始"并回大厅；服务端 claim/release 门禁继续兜底。

### 测试

主套件 +40 项（新增"URL join 已开始房间 → game-already-started"）、深套件 +31 项（D9 同类断言）。

## 第十二轮（2026-09-13）：选座阶段成员操作改版（需求方指定）+ 反向合并评估

### 成员席位操作改版

- **交互**：房主点击**已准备成员**的席位按钮 → 该按钮内展开操作：**左侧"交换座位"**（成员移入房主选中席位，房主改选该成员原席位）/ **右侧"踢出"**（成员被弹窗移出并吊销 token）；再次点击收起。独立"移出"按钮面板与"交换座位"切换模式**删除**。
- `server.js`：新增 **`move-member`** 处理器（仅房主、仅未开始；成员身份/昵称/token/历史快照随成员迁移至目标空闲席，被移成员 socket 收 `seat-moved` 同步缓存）；
- `ServerClaimSeatStage.tsx`：`memberActionSeat` 状态 + 席位内联操作区；`onSwapSeats` 替换为 `onMoveMember`；
- `App.tsx`：`handleMoveMember` + `seat-moved` 监听（更新成员房间域席位缓存）。

### 反向合并评估（副本 → 主线）

- **主线零漂移**：`HEAD..mainline/main` = 0 新提交，副本 diff 即纯增量（16 文件，+2552/-962），**可直接反向合并**；
- 主线内联分支盘点（新增 ~50 处，全部集中于两点）：`App.tsx`（连接监听、claim-result 分流、底栏 props、StageResolver 透传）与 `AppFooter.tsx`（leftAction/dangerAction）——已有单一出口雏形，合并后如需收敛可渐进引入 `useRoomSession`；
- 新增样式：仅 inline style（LAN 类 + 主题变量），**无新增 CSS 文件**（ss-* 两文件已删）——无样式合并冲突面；
- 结论：**全部可反向合并**；以副本本地 main 直接推补丁/合并到主线仓库即可（工作副本与主线基线一致，无历史分叉负担）。


## 第九轮（2026-09-13）：底栏调整（需求方指定，全局变更）

| 文件 | 变更 |
|---|---|
| `AppFooter.tsx` | "分享"与"设置"按钮**位置对调**（分享在前、设置在后）——全局生效（LAN 对局/Server 选座/各处底栏） |
| `App.tsx` 对局底栏 | server 变体**隐藏"分享"按钮**（`onOpenShare` 不传，房主/成员均不显示；LAN 对局不受影响）；房主仍无"退出房间"仅灰色"解散房间" |
| `ServerPortalStage.tsx` | **不渲染底栏**（AppFooter 移除，对齐 STAGE_VIEW_HIERARCHY_SPEC"大厅无底栏、卡片居中专注"；主题切换仍可在对局/选座阶段进行并全局持久化） |



## 第六轮（2026-09-13）：服务端建房（修复同号撞房与双房主）

### 问题（需求方实测）

大厅建房原先由前端 `Math.random()` 本地生成 5 位房间号再跳转 URL——两端可能生成**相同房间号**，且房主按"首个加入者"判定，出现"两端都显示为房主"。

### 修复：建房走服务端，创建即绑定房主

| 文件 | 变更 |
|---|---|
| `multi-room.js` | RoomStore 新增 `setHost(room, token)`（创建者 token 直接绑定房主，优先于"首个加入者"兜底）与 `generateUniqueRoomId()`（避开活跃容器） |
| `server.js` | socket `create-room` 处理器：接收 `token` → 唯一房间号 → 预建容器 → `setHost` |
| `server-extension.js` | `POST /api/rooms/create`：接收 `token`；房间号唯一性同时校验活跃容器；预建后 `setHost` |
| `ServerPortalStage.tsx` | "创建新对局房间"改为 **fetch POST /api/rooms/create**（携带设备 token）→ 服务端返回唯一房间号 → 跳转；失败显示错误；创建中按钮禁用 |
| `StageResolver.tsx` / `App.tsx` | 透传 `deviceToken`（设备 token）给大厅阶段 |

### 语义

- 创建者按下"创建新对局房间"→ 服务端分配**唯一**房间号并把该设备 token 写为房主 → 之后任何人（包括创建者晚到）经 URL 加入都是成员；
- 同号撞房在服务端生成层被消除（活跃房间号不重发）；
- 兜底：直接访问未创建过的房间 URL → 仍按"首个加入者为房主"懒创建（与加入即玩的旧体验兼容）。


## 第五轮（2026-09-13）：严格阶段门禁 + 单红色按钮（按需求方机制定义）

### 机制定义（需求方）

1. **房主无需准备**：仅一颗红色按钮——对房主显示"开始对局"，对成员显示"准备"；成员经"准备"确认席位（可更改选座），全员准备后房主开始对局，**服务端自动为房主入座首个空闲席位**（昵称随 start-game 载荷）。
2. **严格阶段管理**：未开始对局时拒绝一切对局内请求；开始对局后拒绝前置阶段请求（claim/release）——同浏览器第二标签页无法再凭 localStorage 缓存直进对局。

### 后端变更（server.js）

| 变更 | 说明 |
|---|---|
| `gateInGame` 门禁 | `update-state` / `update-state-no-history` / `undo` / `redo` / `rollback` / `cancel-riichi` / `rename-player` 未开始对局（未锁房）时一律 `action-error "对局尚未开始"` |
| claim-seat 门禁 | 锁房后一律拒绝（`对局已开始，无法更改选座`）——白名单重连改由 join-room 重绑承担 |
| release-seat 门禁 | 锁房后拒绝（成员对局内退出走 leave-room，扩展模块仍会释放席位） |
| join-room 重绑 | 对局已开始时按 token 找回成员已确认席位：自动 `socketToSeat` 绑定 + 下发 `claim-seat-result {gameStarted:true}` |
| start-game 重做 | 校验非房主全员"已准备" → **房主自动入座首个空闲席位**（昵称取载荷）→ 锁房 + 广播 `game-started` + 向房主回发 `claim-seat-result` |
| **`seatNames` 权威映射** | 与 seatTokens 同模式：claim/rename/start-game/swap/release/reset 全链路维护，`reassertSeatIdentity` 同时重断言 token 与昵称——修复过期客户端快照冲刷成员昵称的漏洞 |
| update-state 兜底锁房 | **移除**（锁房唯一入口 = start-game） |

### 前端变更

| 文件 | 变更 |
|---|---|
| `ServerClaimSeatStage.tsx` | 单颗红色按钮（`#b71c1c→#e53935` 渐变）：房主="开始对局"（未全员准备时禁用并显示进度），成员="准备"（已准备显示"已准备"/"更改选座"）；房主隐藏随机选座/席位选择（只读观战）；席位标签改"已准备"；房主昵称标注"开始对局时自动入座" |
| `App.tsx` | server 模式 `mySeatId` 初始恒为 null（**修复第二标签页凭缓存直进对局**）；popstate/导航均重新 join-room 由服务端事件驱动；connect 自动重claim 仅限 LAN；`handleStartGame(playerName)` |
| `StageResolver.tsx` | `onStartGame` 签名携带房主昵称 |

### 测试

主套件重构为 35 项（新增：pre-start 局内请求拒绝、post-start claim/release 拒绝、房主自动入座、join-room 重绑直通对局）；深测调整至 30 项（D1-D5/D8/D9 全部按房主免准备流程重写）。

## 第四轮（2026-09-13）：深度测试 + LAN 样式移植

### 深度测试（新增 `scripts/test-multi-room-deep.js`，28 项，npm run test:multi-room-deep）

覆盖：三麻 3 席全流程、越界 playerId、重复确认幂等、抢占他人已确认席位、房主/成员断线重连（角色与席位按 token 恢复）、四人满员流程、开局后交换/踢人、垃圾 roomId 与畸形载荷、连续 20 次 update-state 压力、start-game 门控、锁房期白名单重连。发现并修复：

| 文件 | 变更 |
|---|---|
| `server.js` | ① **补 `app.use(express.json())`**——主线遗留缺失，导致 create API 的 JSON body（gameMode/settings）完全读不到；② 容器创建链路补 **gameMode**：create API/socket create-room → `preload(roomId, settings, gameMode)` → `getInitialState(settings, gameMode)`（此前三麻房间会按四人创建）；③ claim-seat 补 **playerId 越界守卫**（三麻 playerId=3 会使处理器崩溃） |
| `multi-room.js` | `create/preload` 签名增加 gameMode 并透传 deps |
| `server-extension.js` | create API 预建容器时透传 `req.body.gameMode` |

### LAN 样式移植（按需求：server 两个阶段改用 LAN 视觉体系）

| 文件 | 变更 |
|---|---|
| `components/ServerPortalStage.tsx` | 重写标记：`ss-*` → `claim-stage-*`/`app-header`/`app-title`/`btn`/`form-input` + 主题变量卡片；保留建房/加入逻辑与"公网服务器·对局大厅"徽章 |
| `components/ServerClaimSeatStage.tsx` | 重写标记：`claim-stage-wrapper/card/heading/title/subtitle/badge/form/error/random-btn/seats-grid/submit-btn` + `claim-seat-btn(selected/occupied)`/`claim-seat-tag` + `app-header claim-stage-header`；保留全部大厅确认流程逻辑（随机选座/确认/更改选座/房主面板/交换/移出/开始对局/解散） |
| `components/ServerPortalStage.css`、`ServerClaimSeatStage.css` | **删除**（ss-* 独立模板退役，LAN 样式体系随主题切换） |
| `App.tsx` | 容器类改为 `shouldRenderStage`（不再限 LAN）——server 阶段同样获得全屏 stage 布局 |

### 测试环境备注

回归套件曾出现 3188 端口 ECONNREFUSED/EADDRINUSE——为历史运行残留的僵尸进程以 **Bound**（非 LISTENING）状态占口的**环境问题**（`Get-NetTCPConnection` 可见、`netstat` 不可见），强杀后恢复，与代码无关。

## 第三轮（2026-09-13）：主线样式合并 + 大厅确认流程重构（按需求方机制定义）

先合并主线 3 个 UI 提交（`git merge mainline/main`，无冲突：App.css / App.tsx / HandInputModal.tsx / ServerClaimSeatStage.css / ServerPortalStage.css），再基于最新样式实施。

### 机制（需求方定义）

ServerPortalStage 建房者=房主 → 成员经房间号/URL 加入 → **选座准备阶段（ServerClaimSeatStage）**：成员选座（"随机摸风"改为仅随机选中，不再直接入座）→ 点"确认"完成准备（可更改选座）→ **全员确认后房主"开始对局"** → 服务端锁房 + 广播 `game-started`，所有成员**同步进入对局**。踢人/交换座位仅房主、仅此阶段；对局阶段不设移出功能。

### 后端变更

| 文件 | 变更 |
|---|---|
| `multi-room.js` | RoomStore 新增 `members: Map<token,{seatId}>`（房间成员及确认席位）与 `started`；新增 `addMember`（锁房后不收录新成员）/`setMemberSeat`/`removeMember`/`removeMemberByToken`/`unconfirmedMembers`/`allConfirmed`/`swapMemberSeats`/`lobbyPayload`（不下发 token） |
| `server.js` | ① **移除 update-state 的兜底锁房**（锁房唯一入口 = start-game）；② claim-seat 语义改为"确认选座"：绑定席位 + `setMemberSeat` + 广播 `lobby-updated`，`claim-seat-result` 新增 `gameStarted` 字段（重连时对局已开始则直接进对局）；③ 新增 **`start-game`** 处理器（仅房主；校验全员确认 → `room.locked/started = true` → 广播 `game-started`）；④ 新增 **`swap-seats`** 处理器（仅房主；双方已确认；交换昵称/token/`seatTokens`/socket 绑定/成员记录/历史快照身份）；⑤ switchRoom 换房时同步清空成员席位记录；⑥ kick/leave/reset 联动 `lobby-updated` |
| `server-extension.js` | `leave-room`：释放席位 + `removeMemberByToken`（socket.deviceToken 定向移除成员）+ 广播 `lobby-updated` |

### 前端变更

| 文件 | 变更 |
|---|---|
| `App.tsx` | ① `handleClaimSeat` 移除乐观 `setMySeatId`（server 流程下确认选座不进对局）；② `claim-seat-result` 分流：LAN 原样置位；server 仅 `gameStarted=true` 时置位（重连进对局）；③ 新增 `lobby` state 与 `lobby-updated`/`game-started`/`action-error` 监听（game-started 按房间域缓存席位统一进入对局）；④ 新增 `handleStartGame`/`handleSwapSeats`；⑤ **对局底栏**：房主无"退出房间"，仅灰色"解散房间"（需确认）；成员保留"退出房间" |
| `components/ServerClaimSeatStage.tsx` | **大改**：随机按钮改"随机选座"（仅选中）；提交按钮改"确认"（已确认后显示"更改选座"+等待提示）；房主专属面板：交换座位（两次点选已确认席位）、逐成员"移出"按钮、"开始对局"按钮（`allConfirmed` 才可用，显示确认进度） |
| `components/ScoreBoard.tsx` | **移除**对局阶段"移出"按钮与相关 props（对局阶段代码不动） |
| `components/StageResolver.tsx` | 透传 `lobby`/`onStartGame`/`onSwapSeats`/`onKickPlayer` |
| `components/AppFooter.tsx` | `dangerAction` 改为灰色（与 leftAction 同样式） |

### 测试

`scripts/test-multi-room.js` 重写为 36 项：大厅确认流转（未全员确认拒绝开始）、game-started 同步进入且不跨房、锁房后新加入/匿名拒绝、白名单重连 gameStarted=true、交换座位（含非房主拒绝/未确认席位拒绝）、踢人吊销、解散、API、TTL、单房回归。

## 第二轮修复（2026-09-13）：锁房机制（token 鉴权）落地

首轮实现后实测发现两个严重 bug，根因相同——**设备 token 从未被真正分配**：

1. 前端 `getOrCreateDeviceId()` 仅在 localStorage 已有自定义 id 时返回，而代码从未写入 → 所有请求 token 为空 → 服务器回退 `dev_seat_N`；
2. 锁房时机错误（挂在首次记分而非房主开始对局）。

### 修复内容

| 文件 | 位置 | 变更 |
|---|---|---|
| `frontend/src/App.tsx` | :62-84 | **token 生成**：`getOrCreateDeviceId()` 首次访问即生成随机 token（`dev_` + 12 位 hex，crypto.getRandomValues）并长期缓存 localStorage，刷新/重连不变；遇旧版风位派生 ID（dev_seat_N/玩家N）清除重生成 |
| `frontend/src/App.tsx` | handleReleaseSeat / handleExitRoom 确认回调 | **移除** `localStorage.removeItem('mahjong-device-id')`（2 处）——token 是设备身份，退出房间/释放席位不再销毁 |
| `server.js` | createContainer（:394 附近） | 容器新增 `knownTokens: Set`（锁房前加入/入座 token 白名单）、`seatTokens: Map`（playerId→token 服务端权威映射）、`locked` 初始 false |
| `server.js` | join-room | 多房间时 `rememberToken(room, deviceId)`——**锁房前的加入者 token 进入白名单**（未选座成员在房主开局后仍可完成选座） |
| `server.js` | claim-seat | ① 锁房守卫改用白名单：`locked && !isKnownToken(effectiveToken)` → 拒绝；② **锁房时机改为房主认领席位**（host claim → `room.locked = true`，无需等到首次记分）；③ 成功后 `seatTokens.set(playerId, effectiveToken)` + `rememberToken`；④ 回发 room-role |
| `server.js` | update-state / update-state-no-history | 新增 `reassertSeatTokens(room)`：应用客户端状态快照后，用服务端 `seatTokens` 权威映射**重新断言**各席位的 deviceId（修复过期客户端快照冲刷身份绑定的漏洞——实测正是该漏洞导致踢人后白名单删错 token） |
| `server.js` | kick-player | 被踢 token 取自 `seatTokens`（权威），踢出后 `forgetToken` 从白名单移除 → 锁房期间被踢者无法凭原 token 再加入 |
| `multi-room.js` | RoomStore | create() 增加 `knownTokens`/`seatTokens`；新增 `rememberToken`（锁房后不收录）/ `isKnownToken` / `forgetToken`；`releaseSeat` 同步清理 `seatTokens` |
| `scripts/test-multi-room.js` | 用例更新至 30 项 | 新增：房主认领即锁房（无需记分）、锁房前加入者仍可选座、锁房期同 token 刷新重连放行、主动退出后 token 保留可重进、匿名/空 token 拒绝、被踢 token 吊销 |

### 锁房机制最终语义（验收对照）

1. ServerPortalStage 建房 → 首个 `join-room` 的设备 token 成为房主；
2. 成员经房间号/URL 加入 → token 进入白名单（无论是否已选座）；
3. **房主认领席位 = 开始对局 = 锁房**（另有首次记分兜底加锁）；锁房后：白名单外的新加入（含匿名/空 token/新设备）一律拒绝；
4. 白名单内成员：刷新重连、释放席位后重选，均凭 token 放行；主动退出不吊销 token；
5. 房主可踢人（token 同步吊销）、解散房间；成员可退出房间；
6. token 鉴权全部以服务端 `seatTokens` 权威映射 + `knownTokens` 白名单为准，客户端快照无法冲刷。

---

## 合并方式建议

使用副本内 git 查看精确差异：`git log -1` / `git diff HEAD~1`（副本已移除 origin，仅本地历史）。以下为逐文件变更位置清单。

---

## 1. 新增文件

| 文件 | 内容 |
|---|---|
| `multi-room.js` | 多房间唯一顶层文件：`RoomStore` 容器仓库（惰性建房/上限/TTL 清扫/房间治理）。治理策略：房主=首个 join-room 的设备 token（deviceId）；锁房=首次 update-state 后禁止新 token 加入；踢人/解散仅房主。预留接口（env）：`MULTI_ROOM_MAX_ROOMS`(200)、`MULTI_ROOM_IDLE_DESTROY_MINUTES`(30，未开始房间自动销毁)、`MULTI_ROOM_FINISHED_DESTROY_MINUTES`(120)、`MULTI_ROOM_SWEEP_INTERVAL_SECONDS`(60)。导出 `{ RoomStore, createRoomStore }` |
| `scripts/test-multi-room.js` | 多房间隔离与治理测试套件（socket.io-client 双房交叉验证 + 单房回归节），`node scripts/test-multi-room.js` |

## 2. `server.js`（逐处变更，行号为改后位置）

| 位置 | 变更 |
|---|---|
| :14-23（CLI 块内） | 新增 `--multi-room` / `--multi-room=false` / `--no-multi-room` 参数 → `ENABLE_MULTI_ROOM` |
| :196-221（`const app` 之前插入） | `isMultiRoom` 判定（server 模式 + 开关 + extension 已挂载）；开启时 `require('./multi-room')` 创建 RoomStore（deps 注入 getInitialState 与 onDestroy 清扫回调）、`startSweep()`、`serverExtension.setRoomStore(roomStore)` 注入 |
| :240-267（/api/health） | `multiRoomEnabled` 改用 `isMultiRoom`；追加 `multiRoom: { roomCount, maxRooms }` |
| :269-285（/api/rooms） | 多房间开启时返回真实容器列表（`roomStore.listRooms()`，过滤 default）；关闭语义不变 |
| :390-413（原单例区） | **替换**：`currentState/historyStack/redoStack/socketToSeat` 四个模块级单例 → `createContainer()` 容器工厂 + `defaultRoom` 单容器；新增 `roomTarget(room)` / `emitToRoom(room, event, payload)` 按房广播（关闭态=io.emit 保持原语义）；`pushHistory(room, state)` 房间化 |
| :417 起（io.on('connection') 头部） | 新增连接即 `socket.join(socket.targetRoomId \|\| 'default')`；新增三个连接级助手：`getSocketRoom(payloadRoomId?)`（多房间动态解析，载荷 roomId 权威重绑）、`switchRoom(sock, newRoomId)`（换房释放旧容器席位 + 重新 join）、`releaseSeatInRoom(room, seatIdx)`（席位释放统一实现，含快照同步） |
| join-room 处理器 | 多房间：`claimHostIfNeeded`（首连设备 token 成为房主）+ 回发 `room-role {roomId, isHost}` + 回新房状态；单房：行为不变 |
| create-room 处理器 | 房间码 4 位改 **5 位**（与前端对齐）；多房间时查重 + `preload` 预建容器 + 上限拒绝 |
| claim-seat 处理器 | 房间化引用；**锁房守卫**：`room.locked && !isKnownDevice → 拒绝（对局已开始，房间已锁定）`；claim 后回发 `room-role` |
| release-seat 处理器 | 接收 `{ roomId }` 载荷（前端已发送），房间化释放 |
| rename / update-state-no-history / update-state | 房间化引用；update-state 首次触发时 `room.locked = true`（锁房时机）；广播按房 |
| cancel-riichi / undo / rollback / redo | 房间化引用；广播与 history-info 按房 |
| reset-game | 房间化；多房间时 `room.locked = false`（新开局重新开放加入）；`force-clear-seats`/广播按房（**消除跨房清席**） |
| **新增 kick-player 处理器**（disconnect 之前） | 房主 token 鉴权（非房主 → `action-error`）；不可踢房主自己 token 所在席位；释放席位 + 房内广播 + 被踢 socket 收 `kicked` 事件 |
| disconnect 处理器 | 按 socket 当前房间容器释放席位，广播按房 |

## 3. `server-extension.js`

| 位置 | 变更 |
|---|---|
| :25-27（activeRooms 后） | 新增 `roomStoreRef`（多房间容器仓库引用）与 `createRate`（建房每 IP 频控表，10 次/小时） |
| 模块对象新增 `setRoomStore(store)` | server.js 多房间开启时注入 |
| `POST /api/rooms/create` | 多房间时：房间上限检查（503）→ 每 IP 频控（429）→ `roomStoreRef.preload()` 预建容器 |
| `leave-room` 处理器 | 多房间时安全网：若该 socket 在房间内仍有席位则先释放并广播 |
| `disband-room` 处理器 | 多房间时走 `roomStoreRef.disband(rId, deviceId)`（房主 token 鉴权），成功后 `force-clear-seats` + `room-disbanded` 按房广播；未注入 store 时保留原行为 |

## 4. 前端（最小增量，协议字段此前已就绪）

| 文件 | 位置 | 变更 |
|---|---|---|
| `App.tsx` | mySeatId state 后（约 :220） | 新增 `isHost` state（由 `room-role` 事件驱动） |
| | `handleNavigateToRoom`（约 :241） | 换房时 `setIsHost(false)`（待 room-role 重估） |
| | socket 监听区（约 :590-600） | 新增 `room-role` / `kicked` 监听；kicked → 清席位缓存 + 提示 + 返回大厅 |
| | effect cleanup（约 :622-624） | 补 `off('room-role')` / `off('kicked')` |
| | （约 :600） | 删除 `void isHost;` |
| | （约 :640） | **删除遗留死代码** `const isHost = true; // eslint-disable...`（与新 state 重名，注释审计早已标记） |
| | `handleExitRoom` 后（约 :782-810） | 新增 `handleDisbandRoom`（确认弹窗 → `disband-room {roomId, deviceId}`）与 `handleKickPlayer(playerId)`（确认弹窗 → `kick-player`） |
| | StageResolver 调用（约 :866） | 透传 `isHost={isServer && isHost}` / `onDisbandRoom` |
| | ScoreBoard 调用（约 :1712） | 透传 `isHost={isServer && isHost}` / `onKickPlayer={handleKickPlayer}` |
| | 游戏底栏 AppFooter（约 :1777） | 追加 `dangerAction`（房主显示"解散房间"） |
| `components/AppFooter.tsx` | Props + 左侧区 | 新增 `dangerAction` 可选 prop（红色下划线文字动作，与 leftAction 并排） |
| `components/StageResolver.tsx` | Props | 新增 `isHost?` / `onDisbandRoom?`（经 `{...props}` 透传至 ServerClaimSeatStage） |
| `components/ServerClaimSeatStage.tsx` | Props + 底栏 | 新增两 props；`isHost` 时底栏显示"解散房间" |
| `components/ScoreBoard.tsx` | Props + 玩家卡头部 | 新增两 props；房主对其他**已连线**成员显示"移出"小按钮 |

## 5. `scripts/pack-zip.js`

| 位置 | 变更 |
|---|---|
| :40-43 coreFiles | server 目标追加 `multi-room.js`（与 server-extension 同进退：LAN 包不含，符合"多房间代码互相关联、整体开关"的要求） |

## 6. 机制速查（验收对照）

1. **建房即房主**：ServerPortalStage 本地生成房间号 → 进入房间首个 `join-room` 的设备 token 成为房主（服务器标记）。
2. **房间号加入**：`/12345` URL 或大厅输入房间号 → join-room 绑定容器；房号即入口。
3. **锁房**：首次 `update-state`（记分开始）后房间锁定，新设备 token claim 被拒（"对局已开始，房间已锁定"）；已知 token（席位绑定/房主）重连、换座不受影响。
4. **踢人**：对局界面玩家卡"移出"按钮（仅房主可见）→ `kick-player`；被踢者收 `kicked` 自动回大厅，且锁定期间无法凭原 token 再加入。
5. **解散**：底栏"解散房间"（仅房主，选座阶段与对局阶段均有）→ `disband-room`；全员收 `room-disbanded` 回大厅，容器销毁。
6. **离开**：成员"退出房间" → `release-seat` + `leave-room`（leave-room 带席位释放安全网）。
7. **token 鉴权**：身份=前端 localStorage 缓存的 `mahjong-device-id`（不变化的设备 token）；席位占用校验、同设备顶替、锁房放行、房主判定全部基于 token。
8. **预留接口**：最大房间数 / 未开始房间销毁时间 / 已终局保留时间 / 清扫周期（见 multi-room.js 头注），缺省即用，env 可调。
