# 架构

Jello Music Framework 是一个 Electron 主进程 + Vue 3 渲染进程的本地音乐播放器。主进程负责文件系统、标签解析、本地协议与窗口生命周期；渲染进程只负责界面、播放元素与频谱分析。

## 进程边界

```
渲染进程 (sandbox, contextIsolation)
  src/components/sigma/*        Sigma 界面与播放器
  src/stores/player.js          队列、播放模式、进度持久化
  src/services/source/*         曲库适配器（默认本地文件夹）
  window.jello.*                由 preload.cjs 暴露的窄 IPC
        │
        │  settings / library / player / window / spectrum
        ▼
主进程
  electron/main.js              应用生命周期、托盘、HUD 窗口、全局快捷键
  electron/ipc/index.js         IPC 注册与窗口作用域校验
  electron/services/localLibrary.js
                                文件夹扫描、music-metadata 标签、封面缓存、
                                library.json、jello-local 协议
  electron/windows/*            桌面歌词、频谱 HUD、贴边收起
```

## 本地曲库

1. 用户在渲染层点击「导入音乐」。
2. `library:import-folder` 由主进程弹出目录选择框；扫描递归遍历音频扩展名。
3. `music-metadata` 读取标题、歌手、专辑、时长和内嵌封面；文件路径经 SHA-1 生成稳定曲目 ID。
4. 结果写入 `userData/library.json`，封面写入 `userData/covers/`。
5. 渲染层拿到的是 `{ hash, name, author, album, img, timeLength, ... }`，不含真实路径。

再次扫描时，路径、大小与 mtime 都没变的文件直接沿用上次结果；已消失的文件从索引中剔除。

## 媒体协议

`jello-local://audio/<hash>` 与 `jello-local://cover/<hash>`：

- 协议在 `app.ready` 前注册为 `standard + secure + stream + corsEnabled`。
- 处理器只接受 `audio` / `cover` 两个主机名与已入库的曲目 ID，无法读取任意路径。
- 音频支持单段 `Range` 请求，返回 206 与 `Content-Range`；HEAD 返回头部；OPTIONS 返回 204。
- 固定返回 `Access-Control-Allow-Origin: *`，供 `<audio>` 与自解码频谱的 fetch 使用。

## 播放链路

`src/stores/player.js` 维护队列、当前索引、播放模式与失败自动跳歌。每次加载：

1. `getSongUrl(song)` 通过 IPC 确认文件仍在，返回 `jello-local://` URL 与扩展名。
2. `<audio>` 元素立即播放；Web Audio 图按设置接入响度归一/输出设备。
3. 频谱开启时，后台取回整首字节并尝试自解码；失败则保持实时 tap 链路。
4. 播放状态每 5 秒、暂停、换歌与退出时写入 `playback.json`。

## 歌词

- 内嵌歌词页与桌面歌词都读取音频同目录的同名 `.lrc`。
- 主进程按 UTF-8 解码；出现替换字符时回退 GBK。
- 渲染层复用 `src/services/lyrics/lrc.js` 解析时间轴。

## 安全

- 主窗口 `sandbox: true`、`contextIsolation: true`、`webSecurity: true`，禁止 `webview`。
- IPC 通道在 `electron/ipc/index.js` 集中注册，并按 `main` / `hud` / `any` 作用域校验发送窗口。
- CSP 由 `shared/csp.js` 生成：默认只允许自身资源，媒体/封面只允许 `jello-local:` 与 `blob:`。
- 不持有账号、token、Cookie；没有登录页面和网络曲库客户端。

## 扩展点

默认来源实现：

- `src/services/source/localLibrary.js`（渲染层）
- `electron/services/localLibrary.js`（主进程）

接入其他来源时保持 `getSongUrl` 返回 `{ url, extName }`、`getLyrics` 返回 `{ lines }` 即可；队列、界面、频谱与桌面歌词无需修改。
