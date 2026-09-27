# 日麻计分板 (Riichi Mahjong Scoreboard)

> 为移动设备设计的立直麻将（日麻）记分板

<p align="center">
  <img src="assets/preview.png" alt="日麻计分板移动端对局界面" width="360" />
</p>

---

## 部署流程 (Deployment)

### 1. 通过编译产物部署

如果您不需要修改源代码，只需拉取 `release` 分支或下载打包好的 Release ZIP 压缩包：

```bash
# 进入运行目录并安装运行依赖
npm install --production

# 局域网模式 (LAN Mode)
# Windows:
start-lan.bat
# Linux / Android Termux / macOS:
bash start-lan.sh

# 服务器模式 (Server Mode)
# Windows:
start-server.bat
# Linux / Android Termux / macOS:
bash start-server.sh
```

---

### 2. 在 Android Termux 中部署


#### 2.1 环境准备
在 Termux 终端中执行：
```bash
pkg update -y && pkg install -y nodejs-lts git
```

#### 2.2 部署与启动
拉取 `release` 编译产物分支（或下载解压 Release ZIP 包）：
```bash
# 后台保活
termux-wake-lock
git clone -b release --single-branch https://github.com/AAAA1111-Lab/riichi-mahjong-scoreboard.git rms
cd rms
npm install --production
bash start.sh
```

---

### 3. 通过源码编译部署

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
# 局域网版构建:
npm run build
# 服务器版构建:
npm run build:server

# 4. 源码直接启动 Server 模式
npm run start:server
```

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
