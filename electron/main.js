import { app, BrowserWindow, dialog, screen, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IPC, SETTINGS_ARG, hasSettingsArg, formatTrayTooltip } from '../shared/ipc.js';
import { initSettings, getSettings } from './services/settingsStore.js';
import { registerIpc } from './ipc/index.js';
import { initLogSink, flushLogs, recordRendererMessage } from './services/logSink.js';
import { applyGpuAccelerationFlag } from './services/runtimeFlags.js';
import { getTrayInstance, hasTray, initTray, setTrayTooltip, syncTray } from './tray.js';
import customTrayMenu from './services/customTrayMenu.js';
import { destroyDesktopLyrics, getDesktopLyricsWindow, syncDesktopLyrics } from './windows/desktopLyrics.js';
import { destroySpectrumHud, getSpectrumWindow, syncSpectrumHud } from './windows/spectrumHud.js';
import { initUpdater, stopUpdater } from './services/updater.js';
import { initGlobalKeyListener, stopGlobalKeyListener } from './services/globalKeyService.js';
import { registerMediaKeys, stopMediaKeys } from './services/mediaShortcuts.js';
import {
  beginNudge,
  dockMainWindow,
  initDockController,
  isMainWindowDocked,
  isMainWindowDragActive,
  isNudgeActive,
  raiseMainWindow,
  resetDockState,
  restoreMainWindow,
  stopDockAnimation,
  toggleMainWindowDock
} from './windows/sigmaDock.js';
import { installSigmaSizeGuard } from './services/sigmaSizeGuard.js';
// 顶层 import 即触发 jello-local 协议的 privileged 注册（必须先于 app ready）
import { initLocalProtocol } from './services/localLibrary.js';

// 设置与本地音乐库放在独立目录，避免与完整客户端互相覆盖。
app.setName('Jello Music Framework');
app.setPath('userData', path.join(app.getPath('appData'), 'jello-music-framework'));
app.setAppUserModelId('cn.jello.music.framework');

// Chromium 的 Windows 网络变化探测在部分机器上会反复输出无害的
// WSALookupServiceBegin 10108 错误；只压掉 Chromium 错误级日志，
// 应用自身的 console/错误处理和侧车 stderr 不受影响。
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('log-level', '3');
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

// ===== ready 之前必须完成的设置 =====
// 日志器最先起：后面所有 console 才有落盘副本可导
initLogSink();
// GPU 开关必须在 app.ready 之前落定：disableHardwareAcceleration 与透明窗口的
// 软件合成开关只对「尚未建起的 GPU 进程」有效，ready 之后再调只是记个标志。
// 因此设置存储也要提前初始化（electron-store 只读 userData，不依赖 ready）。
initSettings();
applyGpuAccelerationFlag(getSettings().gpuAcceleration);

let mainWindow = null;
let isQuitting = false;
let shutdownStarted = false;

// ===== 启动意图：跳转列表 --settings =====
// 渲染层挂载时通过 app:launch-intent 拉取一次
let pendingOpenSettings = false;

const consumeLaunchIntent = () => {
  const intent = { openSettings: pendingOpenSettings };
  pendingOpenSettings = false;
  return intent;
};

const openSettingsView = () => {
  showMainWindow();
  const ready = !!mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading();
  console.info('[tray-menu] 打开设置：窗口就绪=', ready,
    '可见=', !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible());
  if (ready) {
    mainWindow.webContents.send(IPC.UI_NAVIGATE, { path: '/settings' });
  } else {
    // 窗口尚未就绪：记下意图，渲染层挂载后拉取
    pendingOpenSettings = true;
  }
};

// 二次启动的 argv 里可能带 --settings（跳转列表）
const handleLaunchArgv = (argv) => {
  const windowReady = mainWindow && !mainWindow.isDestroyed();
  if (hasSettingsArg(argv)) {
    if (windowReady) openSettingsView();
    else pendingOpenSettings = true; // 首实例还在启动：记下意图，挂载后拉取
  } else if (windowReady) {
    showMainWindow();
  }
};

// 单实例锁：第二个实例把 argv 转交首个实例后退出，避免重复托盘/侧车抢端口
if (!app.requestSingleInstanceLock()) {
  app.quit();
  // 此刻尚未初始化任何服务，直接退出，跳过 before-quit 清理链
  process.exit(0);
}
app.on('second-instance', (_event, argv) => handleLaunchArgv(argv));
// 冷启动 argv：--settings（跳转列表）
if (hasSettingsArg(process.argv)) pendingOpenSettings = true;

// Windows 跳转列表：任务栏图标右键 → 任务 → 设置。
// 外壳装饰类接口失败绝不能中断启动流程，否则后面的 createWindow 不会执行
const setupJumpList = () => {
  if (process.platform !== 'win32') return;
  try {
    const status = app.setJumpList([
      {
        type: 'tasks',
        items: [
          {
            type: 'task',
            program: process.execPath,
            args: SETTINGS_ARG,
            title: '设置',
            description: '打开 Jello Music Framework 设置',
            iconPath: process.execPath,
            iconIndex: 0
          }
        ]
      }
    ]);
    if (status !== 'ok') console.warn('[jumplist] 设置未生效:', status);
  } catch (error) {
    console.warn('[jumplist] 设置异常:', error?.message || error);
  }
};

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  // 呼出即视为用户要面板在前：置顶 600ms（全屏前台时保持），再自动降回
  raiseMainWindow();
  if (isMainWindowDocked()) restoreMainWindow();
}

function handleRightShift() {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible() || mainWindow.isMinimized()) {
    showMainWindow();
    return;
  }
  // 拖拽会话进行中（左键按住面板）：第一次按 = 侧边轻推一下再平滑回到鼠标
  // 预期位置（渲染层 rAF 手势，结束后重定拖拽基准无缝交还拖拽，不收起）；
  // 轻推中再按 = 明确要收起，直接 dock——渲染层收到 dock-changed 会终止
  // 手势与拖拽会话，旧拖拽基准不会再把面板拽回鼠标位置
  if (isNudgeActive()) {
    dockMainWindow();
    return;
  }
  if (isMainWindowDragActive() && !isMainWindowDocked() && beginNudge()) return;
  const wasDocked = isMainWindowDocked();
  toggleMainWindowDock();
  // 与旧版 toggleSigmaWindowFromHotkey 一致：滑出后置顶，否则按了像没反应
  if (wasDocked && !isMainWindowDocked()) raiseMainWindow();
}

function sendPlayerCommand(command) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('player:command', command);
  }
}

const quitApplication = () => {
  isQuitting = true;
  app.quit();
};

// GPU 开关之类的设置在 UI 上提示「需重启」，用户点「立即重启」时走这里。
// 仍走正常退出链（不 app.exit），让日志与窗口状态先落盘。
const restartApp = () => {
  app.relaunch();
  flushLogs();
  quitApplication();
};

// 多屏时在光标所在显示器打开：用户通常在当前工作的屏幕上唤起面板，
// 固定主屏会让副屏用户每次都要手动拖过去。返回工作区内居中的坐标。
const initialWindowPosition = () => {
  const WINDOW_WIDTH = 800;
  const WINDOW_HEIGHT = 600;
  let display;
  try {
    display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  } catch {
    display = null;
  }
  const area = (display || screen.getPrimaryDisplay()).workArea;
  const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
  return {
    x: clamp(Math.round(area.x + (area.width - WINDOW_WIDTH) / 2), area.x, area.x + Math.max(0, area.width - WINDOW_WIDTH)),
    y: clamp(Math.round(area.y + (area.height - WINDOW_HEIGHT) / 2), area.y, area.y + Math.max(0, area.height - WINDOW_HEIGHT))
  };
};

function createWindow() {
  const position = initialWindowPosition();
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    x: position.x,
    y: position.y,
    minWidth: 800,
    minHeight: 600,
    maxWidth: 800,
    maxHeight: 600,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    show: false,
    skipTaskbar: true,
    icon: path.join(__dirname, 'assets', 'app-icon.png'),
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      autoplayPolicy: 'no-user-gesture-required',
      // 主窗口隐藏到托盘后仍需按播放进度更新桌面歌词
      backgroundThrottling: false
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // 尺寸守卫：跨缩放显示器拖动/系统缩放变化时 WM_DPICHANGED 可能改坏
  // 无边框透明窗口尺寸（Chromium issue 40813134），双层校验并自动修复
  const disposeSizeGuard = installSigmaSizeGuard(() => mainWindow, 800, 600);

  mainWindow.on('close', (event) => {
    if (isQuitting || !getSettings().minimizeToTray || !hasTray()) return;
    event.preventDefault();
    mainWindow?.hide();
  });

  mainWindow.on('minimize', (event) => {
    if (!getSettings().minimizeToTray || !hasTray()) return;
    event.preventDefault();
    mainWindow?.hide();
  });

  mainWindow.on('closed', () => {
    disposeSizeGuard();
    resetDockState();
    mainWindow = null;
    // 桌面歌词窗口是 closable:false 的辅助窗口，不能让它把应用留在后台
    if (!isQuitting) app.quit();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = devServerUrl ? url.startsWith(devServerUrl) : url.startsWith('file://');
    if (!allowed) event.preventDefault();
  });

  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

}

// ===== 托盘悬停提示（正在播放）=====
// 复用自绘托盘菜单的 store 抓取机制（executeJavaScript），不为提示新增 IPC 通道。
// 2s 轮询即节流；setTrayTooltip 内部对相同文案去重，避免无谓的原生调用。
let trayTooltipTimer = null;
let trayTooltipScraping = false;

const startTrayTooltipSync = () => {
  if (trayTooltipTimer) return;
  trayTooltipTimer = setInterval(() => {
    if (trayTooltipScraping || !hasTray()) return;
    const win = mainWindow;
    if (!win || win.isDestroyed() || win.webContents.isLoading()) return;
    trayTooltipScraping = true;
    customTrayMenu.getMenuState(win)
      .then((state) => {
        setTrayTooltip(formatTrayTooltip({
          playing: state?.isPlaying,
          title: state?.song?.title,
          artist: state?.song?.artist
        }));
      })
      .catch(() => {})
      .finally(() => {
        trayTooltipScraping = false;
      });
  }, 2000);
};

const stopTrayTooltipSync = () => {
  if (trayTooltipTimer) {
    clearInterval(trayTooltipTimer);
    trayTooltipTimer = null;
  }
};

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
  // Electron 45+ 事件对象签名（旧位置参数签名已弃用，注册即打印警告）
  contents.on('console-message', (details) => {
    if (details?.message == null) return;
    const source = details.sourceId || '';
    const line = details.lineNumber;
    recordRendererMessage(details.level, details.message, line ? `${source}:${line}` : source);
  });
});

app.whenReady().then(async () => {
  initUpdater();
  initLocalProtocol();
  setupJumpList();
  initDockController(() => mainWindow);
  // IPC 信任粒度：scope 显式声明、注册器集中强制（见 ipc/index.js / ipc/scope.js）
  registerIpc(
    {
      main: () => mainWindow,
      lyrics: getDesktopLyricsWindow,
      spectrum: getSpectrumWindow
    },
    { consumeLaunchIntent, restartApp }
  );
  initTray({
    showWindow: showMainWindow,
    quit: quitApplication,
    playPause: () => sendPlayerCommand('toggle'),
    previous: () => sendPlayerCommand('previous'),
    next: () => sendPlayerCommand('next'),
    showHide: () => {
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
        mainWindow.hide();
        return;
      }
      showMainWindow();
    },
    openSettings: openSettingsView
  });
  customTrayMenu.init(
    () => mainWindow,
    () => getTrayInstance(),
    {
      showHide: () => {
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
          mainWindow.hide();
          return;
        }
        showMainWindow();
      },
      openSettings: openSettingsView,
      playPause: () => sendPlayerCommand('toggle'),
      previous: () => sendPlayerCommand('previous'),
      next: () => sendPlayerCommand('next'),
      quit: quitApplication
    }
  );
  syncTray(getSettings().minimizeToTray);
  startTrayTooltipSync();
  createWindow();
  syncDesktopLyrics(getSettings().desktopLyrics);
  syncSpectrumHud(getSettings().spectrum);
  initGlobalKeyListener({ onRightShift: handleRightShift });
  registerMediaKeys({ sendCommand: sendPlayerCommand });

  app.on('activate', showMainWindow);
  // 频谱相位实机标定诊断（JELLO_DIAG=1 时启动：频谱帧/播放位置打点 + 本机控制端口）
  if (process.env.JELLO_DIAG === '1') {
    try {
      const { initDiagServer } = await import('./services/diagServer.js');
      initDiagServer();
    } catch (error) {
      console.error('[diag] 初始化失败:', error?.message || error);
    }
  }
}).catch((error) => {
  // 启动链中任一步抛错都会跳过 createWindow，留下无窗口、无托盘却仍占着
  // 单实例锁的僵尸进程（之后再启动会静默退出）。显式报错并用 app.exit 跳过
  // before-quit 清理链（此时部分服务尚未初始化）
  console.error('[startup] 初始化失败:', error?.stack || error);
  try {
    dialog.showErrorBox('Jello Music Framework 启动失败', String(error?.stack || error));
  } catch {
    /* 对话框不可用时至少留下控制台记录 */
  }
  app.exit(1);
});

app.on('before-quit', (event) => {
  isQuitting = true;
  if (shutdownStarted) return;

  shutdownStarted = true;
  event.preventDefault();
  flushLogs();
  stopTrayTooltipSync();
  stopMediaKeys();
  stopGlobalKeyListener();
  stopDockAnimation();
  stopUpdater();
  customTrayMenu.cleanup();
  destroyDesktopLyrics();
  destroySpectrumHud();
  app.quit();
});

app.on('window-all-closed', () => {
  app.quit();
});
