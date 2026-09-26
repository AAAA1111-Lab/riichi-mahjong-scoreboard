# 日麻计分板 (Riichi Mahjong Scoreboard)

> 为移动设备设计的立直麻将（日麻）记分板

<p align="center">
  <img src="assets/preview.png" alt="日麻计分板移动端对局界面" width="360" />
</p>

---

## 部署流程 (Deployment)

### 1. 快速使用（直接运行编译产物）

如果您不需要修改源代码，只需拉取 `release` 分支或下载打包好的 Release ZIP 压缩包：

```bash
# 进入运行目录并安装运行依赖
npm install --production

# 方式 A：局域网单桌模式 (LAN Mode, 默认端口 32000, 纯净零多房间开销)
# Windows:
start-lan.bat
# Linux / Android Termux / macOS:
bash start-lan.sh

# 方式 B：公网多房间与安全模式 (Server Mode, 支持对局大厅/5位房间/安全拦截/后台管理)
# Windows:
start-server.bat
# Linux / Android Termux / macOS:
bash start-server.sh
```

启动后，打开浏览器访问 `http://localhost:32000` 或扫描控制台打印的局域网二维码即可在各端设备上即开即用。

---

### 2. Android Termux 手机部署与离线开局指南

本项目支持直接在 Android 手机的 **Termux** 中作为**全功能日麻计分板主机**运行。无需电脑，无需任何第三方 GUI 插件，随时随地开局。

#### 2.1 环境准备 (仅需 1 个标准包)
在 Termux 终端中执行：
```bash
pkg update -y && pkg install -y nodejs-lts git
```
*注：完全不需要 Python，亦不需要安装任何第三方 APK 插件。*

#### 2.2 部署与启动
拉取 `release` 编译产物分支（或下载解压 Release ZIP 包）：
```bash
git clone -b release --single-branch https://github.com/AAAA1111-Lab/riichi-mahjong-scoreboard.git riichi-scoreboard
cd riichi-scoreboard
npm install --production
bash start.sh
```
*启动后，在手机任意浏览器中访问 `http://localhost:32000` 即可使用。*

#### 2.3 后台保活防休眠
在 Termux 中执行以下命令，防止系统在锁屏或息屏时休眠后台进程：
```bash
termux-wake-lock
```

#### 2.4 沉浸式体验：一键生成全屏独立 App (PWA)
在手机浏览器打开计分板后：
1. 点击浏览器菜单（右上角或右下角三点 `...`）；
2. 选择 **「添加到主屏幕」** 或 **「安装应用」**；
3. 手机桌面上将生成独立的 **「日麻计分板」** 图标，启动后享受完全无浏览器地址栏的原生全屏 App 体验。

#### 2.5 4 人无网络离线对局方案 (零电脑·完全离线)
1. **手机开启个人热点**；
2. **在 Termux 中启动计分板**（本机作为主机加入）；
3. **其他 3 位选手连接该手机热点**，在浏览器中输入热点 IP（如控制台提示的 `http://192.168.43.1:32000`）即可完成选座与全场毫秒级同步对局。

---

### 3. 源码开发与二次构建

```bash
# 1. 安装项目完整依赖
npm install
npm install --prefix frontend

# 2. 启动开发模式
# 后端 (端口 32000)
node server.js
# 前端 Vite 热重载 (端口 5173)
npm run dev --prefix frontend

# 3. 生产环境构建
# 局域网标准版构建:
npm run build
# 公网多房间版构建:
npm run build:server

# 4. 源码直接启动 Server 模式
npm run start:server
```

---

## 功能特点 (Features)

- **移动端与全端响应式设计**：
  - 专为手机竖屏触控打牌深度定制，手势操作流畅，支持 PWA 桌面全屏独立 App 模式。
  - 字体与按钮具备防误触设计，大字号点数与状态回显，低头看牌、抬手记分轻松无负担。
- **多端毫秒级实时同步**：
  - 基于 WebSocket / Socket.IO，多台手机、平板同屏实时互联。
  - 自动呈现各选手点数差额、本局点数变动预览与标准结构化对局日志。
- **完备的日麻规则与结算引擎**：
  - 支持 **一炮多响 (Multi-Ron)**、**击飞 (Dobon)**、**切上满贯 (Kiriage Mangan)**、**西入 (West Round)**、**尾亲一位完场 (Agari-Yame)**、**流局满贯 (Nagashi Mangan)**、**庄家听牌连庄/轮庄判定**、**诈和罚点** 等主流赛制配置。
  - 自动管理 **场存立直棒**、**本场棒**、**连庄与轮庄**、**精确点数收支**。
  - 完备的撤销 (Undo)、重做 (Redo) 与任意对局记录时间线精准回滚。
- **公网多房间治理与生命周期**：
  - 纯数字 5 位房间号（如 `/12345`），支持房间大厅一键创建、房间分享二维码与直达链接。
  - 房主选座锁定、席位交换与移出（踢人）权限模型。
  - **全自动化内存生命周期**：未开局房间 5 分钟超时自动解散、已终局房间保留 5 分钟查阅、对局中房间最大保留 5 小时（剩余 1 小时自动推送全员弹窗提醒）。
  - **网络安全与防刷治理**：单 IP 每小时限创 10 房频控、全局最大 200 房间硬上限、恶意路径探测与注入清洗防御。
- **5 套深度定制主题**：
  - **雀魂风格 (Majsoul)**：沉稳和风深绀青、琥珀金、手绘立直/自摸/荣和令牌与龙藏体毛笔书法字。
  - **工控电子 (Electronic)**：经典高对比度蓝色点阵液晶、工控 HUD 风格灯牌与七段数码管。
  - **硬件工控 (REXX)**：极客工控硬件、椭圆 LED 庄家与下家指示灯。
  - **暗黑沉浸 (Dark)**：低光环境下舒适打牌，纯净红黑搭配。
  - **明亮浅色 (Light)**：暖白护眼质感。
- **100% 本地离线闭环**：
  - 全部字体文件（龙藏体、马善政毛笔楷书、Klee One、Michroma 等）与静态矢量图标内置打包，零外部 CDN 依赖，在无互联网的环境下亦能完美运行。

---

## 技术栈 (Tech Stack)

| 领域 | 核心技术 | 作用与特点 |
| :--- | :--- | :--- |
| **前端 (Frontend)** | **React 18 + TypeScript** | 声明式组件化与类型安全保障 |
| **构建工具** | **Vite** | 极速构建与模块分包优化 |
| **样式体系** | **CSS Variables / Modules** | 5 套独立主题无闪烁热切换 |
| **后端 (Backend)** | **Node.js + Express** | 轻量高效的基础 HTTP 与 API 路由服务 |
| **实时通信** | **Socket.IO** | 局域网/公网多端双向低延迟事件传输 |
| **多房间引擎** | **纯内存状态隔离容器** | 无外部数据库依赖，各房间独立隔离运行与定时回收 |
| **网络安全** | **安全防护中间件 (Security Guard)** | 拦截路径穿越、XSS 注入与恶意爬虫扫描 |

---

## 许可证 (License)

本项目采用 [GNU General Public License v3.0 (GPL-3.0)](https://www.gnu.org/licenses/gpl-3.0.html) 开源许可证。
