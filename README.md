# Jello Music Framework

一个干净、本地优先的 MIT 桌面音乐播放框架。

这个仓库是 [Jello Music 桌面端](https://github.com/Margele1337/jello-music) 去掉在线曲库 API 与账号登录后的框架版本：保留完整的 Sigma 播放器界面、播放队列、频谱、桌面歌词、托盘、右 Shift 呼出/收起和设置页，曲库改为从本地文件夹导入。没有酷狗 API、没有登录、没有 sidecar 进程，也没有遥测。

## 特性

- **本地音乐库**：选择一个或多个文件夹即可导入；支持 mp3 / flac / m4a / aac / ogg / opus / wav / webm；读取标题、歌手、专辑、时长与内嵌封面；再次扫描只解析新增或修改过的文件。
- **离线播放**：音频与封面通过 `jello-local://` 自定义协议由主进程按曲目 ID 提供；支持 Range 请求（拖动进度条）与 CORS，自解码频谱可直接 fetch。渲染进程从不接触真实文件路径。
- **本地检索与推荐**：搜索按歌名/歌手/专辑过滤；左栏提供「本地音乐 / 我喜欢 / 最近添加」，「每日推荐」按日期稳定洗牌，「猜你喜欢」随机洗牌。
- **歌词**：读取音频同目录下的同名 `.lrc`（UTF-8 或 GBK），支持内嵌歌词页与桌面歌词窗口。
- **完整播放器能力**：队列、顺序/随机/单曲循环、播放进度持久化、应用音量与输出设备、响度归一、播放速率、MediaSession/系统媒体键。
- **Sigma UI**：800×600 无边框透明面板、自绘字体图集、右 Shift 呼出/贴边收起、托盘菜单与频谱 HUD。
- **安全默认值**：`contextIsolation`、`sandbox`、`webSecurity` 全开；preload 只暴露窄 IPC；主进程按窗口作用域校验 IPC 来源。

## 开发

需要 Node.js >= 20.19（Windows 打包在 Windows 上执行）。

```sh
npm install
npm run dev       # Vite + Electron
npm run build     # 渲染层生产构建
npm test          # node:test 单元测试
npm run lint      # ESLint
npm run dist      # Windows NSIS 安装包（electron-builder）
```

首次启动后点击播放器右侧的 **+**，或设置页右上角 **导入音乐**，选择一个音乐文件夹。设置 → 音乐库 中可以重新扫描或清空索引（不会删除磁盘文件）。

## 数据位置

- Windows：`%APPDATA%/jello-music-framework/`
- `library.json`：曲库索引、歌词来源目录、我喜欢
- `covers/`：从音频标签提取的封面缓存
- `settings.json` / `playback.json`：界面设置与队列进度

## 作为框架扩展

播放层只依赖一个很窄的来源接口。默认实现位于：

- `src/services/source/localLibrary.js`：渲染层适配器（`searchSongs`、`getPlaylistTracks`、`getDailyRecommend`、`getSongUrl`、`getLyrics`、`toggleSongLiked` 等）。
- `electron/services/localLibrary.js`：主进程扫描、标签解析、协议与持久化。

要接入别的音源（NAS、自建服务、对象存储等），实现同样的函数并保持歌曲对象形状：

```js
{
  hash: 'stable-id',
  name: '歌曲名',
  author: '歌手',
  album: '专辑',
  img: '可选封面 URL',
  timeLength: 240000, // 毫秒
  albumId: '',
  albumAudioId: ''
}
```

`getSongUrl(song)` 返回 `{ url, extName }`，`getLyrics(song)` 返回 `{ lines: [{ time, text }] }`。播放器、队列、频谱、桌面歌词与界面层都不需要改动。

## 安全基线

- 渲染进程没有 Node.js 权限；`preload.cjs` 只暴露 `settings`、`library`、`player`、窗口控制等窄桥。
- IPC 处理器按 `main` / `hud` / `any` 作用域校验发送窗口（`electron/ipc/scope.js`、`security/trustedSender.js`）。
- `jello-local://audio|cover/<id>` 只解析已入库的曲目 ID；不能借协议读取任意路径。
- CSP 由 `shared/csp.js` 统一生成：`default-src 'self'`，媒体/封面只放行 `jello-local:` 与自解码 `blob:`，不包含任何远端曲库主机。
- 不保存账号、token 或 Cookie；本仓库没有登录流程。

## 第三方与来源

- Electron、Vue、Vite、electron-builder：MIT。
- `music-metadata`：MIT，用于读取本地音频标签与封面。
- Roboto（Sigma UI 字体）：SIL Open Font License 1.1。
- TeX Gyre Heros（Sigma 文本图集）：GUST Font License 1.0。
- Feather 图标几何（设置页内联 SVG）：MIT。
- Sigma UI 组件、Jello/Sigma 品牌与图像素材来自仓库作者本人的原创工作，按 MIT 授权。

完整声明见 [NOTICE](NOTICE)。
