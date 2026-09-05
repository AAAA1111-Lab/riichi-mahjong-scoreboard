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

## Android Termux 手机部署指南

1. 在 Android 上打开 **Termux**，安装 Node.js：
   ```bash
   pkg update && pkg install nodejs git -y
   ```
2. 拉取 release 分支并运行：
   ```bash
   git clone -b release --single-branch https://github.com/<YOUR_USERNAME>/<YOUR_REPO>.git riichi-scoreboard
   cd riichi-scoreboard
   npm install --production
   bash start.sh
   ```
3. 保持后台常驻（防手机休眠）：
   ```bash
   termux-wake-lock
   ```

---

## License
MIT License.
