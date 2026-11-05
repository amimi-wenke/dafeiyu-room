# 大肥鱼的小屋 · dafeiyu-room

一个蓝色半立体小屋的 Windows 桌面程序（Electron）。大肥鱼住在里面：会散步、看书、吃白米饭、睡觉，会跟着清晨、白天、黄昏、夜晚变换光照，还能开关灯。她也可以接入 AI，和你聊天，并自己经营户外的「小天地」。

AI 和小天地的逻辑都在独立的 DSH 插件仓库 **[dsh-room-world](https://github.com/amimi-wenke/dsh-room-world)** 里；本仓库只负责画面和本机连接。不装 DSH 时，房间里的本地活动照样能用；聊天和小天地需要 DSH 并启用插件。

## 使用

1. 启动 DSH，安装并启用 dsh-room-world 插件（见插件仓库的 README）。
2. 打开 `Dafeiyu-Room-<版本>-portable.exe`（在 GitHub Release 下载，或者自己构建）。
3. 「和她聊聊」是桌面对话；点击家具也能和她互动。
4. 「小天地」面板显示她的农场、花园、池塘、仓库、商店、图鉴和日记。里面的事都由她自己做，你可以给她留心愿，或者请她重新想想打算。
5. 如果插件接了 QQ 机器人（比如 SurfCore），主人私聊会同步显示到桌面。桌面上的回复只留在桌面，不会发回 QQ。

## 开发与构建

需要 Node.js 22 及以上和 npm。第一次安装或构建时，会从 npm 和 Electron 官方发布源下载依赖。

```bash
npm ci
npm test
npm start
npm run build:win
```

构建产物在 `release/Dafeiyu-Room-<版本>-portable.exe`，大约 140 MB，请放到 GitHub Release，不要提交进仓库。如果开发目录继承了受限的沙箱 ACL，Electron 可能在初始化前就退出；这时把产物复制到普通目录再运行即可，不需要关闭 Electron 沙箱。

浏览器调试：运行 `node connector/server.mjs`，然后打开 `http://127.0.0.1:37621/`（Windows 上也可以双击 `连接DSH.cmd`）。

## 项目结构

- `desktop/main.mjs`：Electron 窗口，以及本机连接器的生命周期。
- `connector/server.mjs`：本机连接器。读取 `~/.dsh/room-world/host.json` 找到插件接口；浏览器只拿到短期会话；负责凭据隔离和重试去重。
- `room.js` / `room.css` / `index.html`：房间、角色动作、路径和时段光照。`index.html` 内嵌了 PNG，运行时不需要外部图片（由 `bundle-assets.mjs` 生成）。
- `dsh-client.js` / `dsh.css`：聊天面板、房间状态回报、指令确认，以及小天地面板。
- `assets/`：房间和角色的原始图片；`assets/world/` 是小天地素材。
- `docs/xiaotiandi-art-assets.md`：小天地美术需求清单。

## 与插件的接口

桌面程序只通过 HTTP 和插件通信，不导入插件代码：

- 连接器从 `~/.dsh/room-world/host.json` 读取插件的本机地址和 token，只接受回环地址；
- 房间每次心跳上报当前动作，拉取房间指令，拉取聊天和小天地状态；
- 小天地面板只调用查看、商店、图鉴、留心愿和请她重新规划这几个接口。

接口细节见 dsh-room-world 仓库的 README。

## 许可

- **代码**：MIT（见 [LICENSE](LICENSE)）。
- **美术资源**（`assets/`，以及 `index.html` 里内嵌的图片）：CC BY-NC-SA 4.0，**不得商用**。大肥鱼形象来自社区开源资产库 [deepseek-whale-girl](https://github.com/TreapGoGo/deepseek-whale-girl)，署名和来源见 [ASSETS.md](ASSETS.md)。

当前版本不采集屏幕、摄像头或麦克风。
