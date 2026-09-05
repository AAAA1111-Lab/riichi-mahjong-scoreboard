# 日麻计分板 (Riichi Mahjong Scoreboard)

现代化、轻量级、多端实时同步的立直麻将专业计分板系统。基于 **Node.js + Express + Socket.IO + React + TypeScript + Vite** 构建，专为手机、平板、PC 和 Android Termux 等各类设备量身定制。

---

## 核心特性

- **多端局域网毫秒级同步**：支持手机扫码加入对局、多设备同屏对局与点数同步。
- **5 套深度定制主题**：
  - **雀魂风格 (Majsoul)**：沉稳和风深绀青、琥珀金、手绘立直/自摸/荣和令牌与龙藏体毛笔书法字。
  - **工控电子 (Electronic)**：经典高对比度蓝色点阵液晶、工控 HUD 风格灯牌与七段数码管。
  - **硬件工控 (REXX)**：极客工控硬件、椭圆 LED 庄家与下家指示灯。
  - **暗黑沉浸 (Dark)**：低光环境下舒适打牌，纯净红黑搭配。
  - **明亮浅色 (Light)**：暖白护眼质感。
- **完备的日麻规则与结算引擎**：
  - 支持 **一炮多响 (Multi-Ron)**、**击飞 (Dobon)**、**切上满贯 (Kiriage Mangan)**、**西入 (West Round)**、**尾亲一位完场 (Agari-Yame)** 等主流规则配置。
  - 自动管理 **场存立直棒**、**本场数**、**连庄/轮庄** 与 **精准点数结算变更预览**。
- **100% 本地离线闭环**：全部字体与静态资源打包离线可用，零外部 CDN 依赖。

---

## 极速部署与运行

### 1. 快速使用（直接运行编译产物）
如果您不需要修改源代码，只需拉取 `release` 分支或下载打包好的 Release ZIP 包：

```bash
# 1. 进入运行目录并安装依赖
npm install --production

# 2. 启动服务 (默认端口 32000)
# Windows:
start-server.bat
# Linux / Android Termux / macOS:
bash start.sh
```

打开浏览器访问 `http://localhost:32000` 或扫描控制台打印的局域网二维码即可在手机上使用。

---

### 2. 源码开发与二次构建

```bash
# 1. 安装项目依赖
npm install
npm install --prefix frontend

# 2. 启动开发模式
# 后端 (端口 32000)
node server.js
# 前端 Vite 热重载 (端口 5173)
npm run dev --prefix frontend

# 3. 生产环境构建
npm run build --prefix frontend
```

---

## Android Termux 手机部署与开局指南

本项目支持直接在 Android 手机的 **Termux** 中作为**全功能日麻计分板主机**运行。无需电脑，无需任何第三方 GUI 插件，随时随地开局。

### 1. 环境准备 (仅需 1 个标准包)
在 Termux 终端中执行：
```bash
pkg update -y && pkg install -y nodejs-lts git
```
*注：完全不需要 Python，亦不需要安装任何第三方 APK 插件。*

### 2. 部署与启动
拉取 `release` 编译产物分支（或下载解压 Release ZIP 包）：
```bash
git clone -b release --single-branch https://github.com/AAAA1111-Lab/riichi-mahjong-scoreboard.git riichi-scoreboard
cd riichi-scoreboard
npm install --production
bash start.sh
```
*启动后，在手机任意浏览器中访问 `http://localhost:32000` 即可使用。*

### 3. 后台保活防休眠
在 Termux 中执行以下命令，防止系统在锁屏或息屏时休眠后台进程：
```bash
termux-wake-lock
```

### 4. 沉浸式体验：一键生成全屏独立 App (PWA)
在手机浏览器打开计分板后：
1. 点击浏览器菜单（右上角或右下角三点 `...`）；
2. 选择 **「添加到主屏幕」** 或 **「安装应用」**；
3. 手机桌面上将生成独立的 **「日麻计分板」** 图标，启动后享受完全无浏览器地址栏的原生全屏 App 体验。

### 5. 4 人无网络离线对局方案 (零电脑·完全离线)
1. **手机开启个人热点**；
2. **在 Termux 中启动计分板**（本机作为主机加入）；
3. **其他 3 位玩家连接该手机热点**，在浏览器中输入热点 IP（如控制台提示的 `http://192.168.43.1:32000`）即可完成选座与全场毫秒级同步对局。

---

## License
MIT License.
