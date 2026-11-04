import { app, BrowserWindow, dialog, ipcMain, powerSaveBlocker, screen, shell } from 'electron';
import { IPC } from '../../shared/ipc.js';
import { getSettings, updateSettings } from '../services/settingsStore.js';
import { getPlaybackState, savePlaybackState } from '../services/playbackStateStore.js';
import { isTrustedSender } from '../security/trustedSender.js';
import { resolveScopeWindows } from './scope.js';
import {
  clearLibrary,
  getLikedHashes,
  importFolders,
  listTracks,
  readLyric,
  rescan,
  resolveTrack,
  scanOnce,
  toggleLiked
} from '../services/localLibrary.js';
import { exportLogsDialog } from '../services/logSink.js';
import { syncTray } from '../tray.js';
import {
  getDesktopLyricsWindow,
  resendDesktopLyricsState,
  sendDesktopLyricsLyrics,
  sendDesktopLyricsProgress,
  setDesktopLyricsFont,
  syncDesktopLyrics
} from '../windows/desktopLyrics.js';
import { sanitizeDesktopLyricLyrics, sanitizeDesktopLyricProgress } from '../../shared/desktopLyrics.js';
import { sanitizeSpectrumPayload } from '../../shared/spectrum.js';
import { getSpectrumWindow, sendSpectrumData, syncSpectrumHud, sendSpectrumSettings, syncSpectrumHudSettings, resetSpectrumHudPosition, flushSpectrumGeometry } from '../windows/spectrumHud.js';
import {
  finishWindowNudge,
  isMainWindowDocked,
  moveMainWindow,
  finishMainWindowDrag,
  getMainWindowBounds,
  restoreMainWindow,
  setMainWindowDragActive,
  toggleMainWindowDock,
  applyAnimatePosition,
  finishAnimate
} from '../windows/sigmaDock.js';
import {
  checkForUpdates,
  downloadUpdate,
  getUpdateState,
  installUpdate
} from '../services/updater.js';

let sleepBlockerId = null;

const applySystemSettings = (previous, next) => {
  if (next.autoStart !== previous.autoStart) {
    app.setLoginItemSettings({ openAtLogin: next.autoStart });
  }
  if (next.preventAppSuspension !== previous.preventAppSuspension) {
    if (next.preventAppSuspension && sleepBlockerId === null) {
      sleepBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    } else if (!next.preventAppSuspension && sleepBlockerId !== null) {
      powerSaveBlocker.stop(sleepBlockerId);
      sleepBlockerId = null;
    }
  }
};

const broadcast = (channel, payload) => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }
};

/**
 * IPC 信任模型：handler 显式声明 scope（'main' | 'hud' | 'any'），由
 * resolveScopeWindows 统一解析成窗口集合再校验，注册器集中强制。
 * - 'main'：危险通道与主窗口专属功能（settings/auth/api/update/window/net/log）。
 *   HUD 窗口走窄 preload 本来就没有这些桥，收紧对真实调用方零影响。
 * - 'any'：保持现状即安全的通道（目前仅频谱数据面），刻意不收紧。
 * - 桌面歌词/频谱的细节通道继续直接对特定窗口校验（比 scope 更细），保持原样。
 */
export const registerIpc = (windows, intents = {}) => {
  const windowsInScope = (scope) => resolveScopeWindows(scope, windows);

  const assertTrusted = (event, scope) => {
    if (!isTrustedSender(event, windowsInScope(scope))) {
      throw new Error('unauthorized ipc sender');
    }
  };

  // ipcMain.on 的静默拒绝版：非法来源直接丢帧，不回错误
  const trustedInScope = (event, scope) => isTrustedSender(event, windowsInScope(scope));

  ipcMain.handle(IPC.APP_VERSION, (event) => {
    assertTrusted(event, 'main');
    return app.getVersion();
  });

  // 渲染层挂载后拉取一次启动意图（--settings / jello:// 深链），返回即清空。
  // 仅主窗口可消费：HUD 窗口（桌面歌词/频谱）跑同一个 App.vue，scope 'main'
  // 已在注册器层挡住，不再需要运行期补判
  ipcMain.handle(IPC.APP_LAUNCH_INTENT, (event) => {
    assertTrusted(event, 'main');
    return intents.consumeLaunchIntent?.() ?? { openSettings: false };
  });

  ipcMain.handle(IPC.APP_OPEN_LOGS, (event) => {
    assertTrusted(event, 'main');
    return shell.openPath(app.getPath('userData'));
  });

  // 导出的是「脱敏副本」：原始 main.log 留在 userData 便于本地排查，
  // 用户拿出去反馈问题的这份先过 token/手机号/设备标识的替换规则
  ipcMain.handle(IPC.APP_EXPORT_LOGS, async (event) => {
    assertTrusted(event, 'main');
    const main = windows.main();
    const parent = main && !main.isDestroyed() ? main : null;
    try {
      return await exportLogsDialog(parent);
    } catch (error) {
      return { ok: false, error: String(error?.message || error).slice(0, 300) };
    }
  });

  // GPU 开关之类「重启后才生效」的设置：重启动作由用户点确认，主进程只负责
  // relaunch + 退出（走 before-quit 清理链，把日志与窗口状态落盘做完）
  ipcMain.handle(IPC.APP_RESTART, (event) => {
    assertTrusted(event, 'main');
    intents.restartApp?.();
    return true;
  });

  ipcMain.handle(IPC.SETTINGS_GET, (event) => {
    assertTrusted(event, 'main');
    return getSettings();
  });

  ipcMain.handle(IPC.SETTINGS_SET, async (event, patch) => {
    assertTrusted(event, 'main');
    const previous = getSettings();
    const next = updateSettings(patch);

    if (next.minimizeToTray !== previous.minimizeToTray) {
      syncTray(next.minimizeToTray);
    }

    if (next.desktopLyrics !== previous.desktopLyrics) {
      syncDesktopLyrics(next.desktopLyrics);
    }

    if (next.desktopLyricsFont !== previous.desktopLyricsFont) {
      setDesktopLyricsFont(next.desktopLyricsFont);
    }

    applySystemSettings(previous, next);

    if (next.spectrum !== previous.spectrum) {
      syncSpectrumHud(next.spectrum);
    }

    syncSpectrumHudSettings(next);

    broadcast(IPC.SETTINGS_CHANGED, next);
    return next;
  });

  // ===== 本地音乐库 =====
  const scanWithProgress = (event, task) => {
    let lastSent = 0;
    return scanOnce(() => task((done, total) => {
      // 进度事件不需要每条文件都发：至少间隔 120ms，最后一条必发
      const now = Date.now();
      if (done !== total && now - lastSent < 120) return;
      lastSent = now;
      if (!event.sender.isDestroyed()) {
        event.sender.send(IPC.LIBRARY_PROGRESS, { done, total });
      }
    }));
  };

  ipcMain.handle(IPC.LIBRARY_GET_TRACKS, (event) => {
    assertTrusted(event, 'main');
    return listTracks();
  });

  ipcMain.handle(IPC.LIBRARY_IMPORT_FOLDER, async (event) => {
    assertTrusted(event, 'main');
    const parent = windows.main();
    const options = {
      title: '导入音乐文件夹',
      properties: ['openDirectory', 'multiSelections']
    };
    const result = parent && !parent.isDestroyed()
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths.length) return { canceled: true, tracks: listTracks() };
    const tracks = await scanWithProgress(event, (onProgress) => importFolders(result.filePaths, onProgress));
    return { canceled: false, tracks };
  });

  ipcMain.handle(IPC.LIBRARY_RESCAN, async (event) => {
    assertTrusted(event, 'main');
    return scanWithProgress(event, (onProgress) => rescan(onProgress));
  });

  ipcMain.handle(IPC.LIBRARY_CLEAR, async (event) => {
    assertTrusted(event, 'main');
    await clearLibrary();
    return [];
  });

  ipcMain.handle(IPC.LIBRARY_RESOLVE, (event, hash) => {
    assertTrusted(event, 'main');
    return resolveTrack(hash);
  });

  ipcMain.handle(IPC.LIBRARY_LYRIC, (event, hash) => {
    assertTrusted(event, 'main');
    return readLyric(hash);
  });

  ipcMain.handle(IPC.LIBRARY_GET_LIKED, (event) => {
    assertTrusted(event, 'main');
    return getLikedHashes();
  });

  ipcMain.handle(IPC.LIBRARY_TOGGLE_LIKED, (event, hash) => {
    assertTrusted(event, 'main');
    return toggleLiked(hash);
  });

  // 播放状态持久化：仅主窗口可读写（HUD 窗口跑同一个 App.vue，不拦会被抢走/误写）。
  // scope 'main' 在注册器层强制，无需运行期补判
  ipcMain.handle(IPC.PLAYBACK_STATE_GET, (event) => {
    assertTrusted(event, 'main');
    return getPlaybackState();
  });

  ipcMain.on(IPC.PLAYBACK_STATE_SET, (event, state) => {
    if (!trustedInScope(event, 'main')) return;
    savePlaybackState(state);
  });

  ipcMain.on(IPC.DESKTOP_LYRICS_UPDATE, (event, state) => {
    if (!trustedInScope(event, 'main')) return;
    sendDesktopLyricsLyrics(sanitizeDesktopLyricLyrics(state));
  });

  ipcMain.on(IPC.DESKTOP_LYRICS_PROGRESS, (event, payload) => {
    if (!trustedInScope(event, 'main')) return;
    sendDesktopLyricsProgress(sanitizeDesktopLyricProgress(payload));
  });

  ipcMain.on(IPC.DESKTOP_LYRICS_READY, (event) => {
    if (!isTrustedSender(event, getDesktopLyricsWindow())) return;
    resendDesktopLyricsState();
  });

  ipcMain.on(IPC.DESKTOP_LYRICS_ACTION, (event, action) => {
    if (!isTrustedSender(event, getDesktopLyricsWindow())) return;
    const commandMap = {
      'toggle-play': 'toggle',
      'previous-song': 'previous',
      'next-song': 'next'
    };
    if (action === 'close-lyrics') {
      updateSettings({ desktopLyrics: false });
      syncDesktopLyrics(false);
      broadcast(IPC.SETTINGS_CHANGED, getSettings());
      return;
    }
    const command = commandMap[action];
    if (!command) return;
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && window !== getDesktopLyricsWindow()) {
        window.webContents.send(IPC.PLAYER_COMMAND, command);
      }
    }
  });

  ipcMain.on(IPC.DESKTOP_LYRICS_IGNORE_MOUSE, (event, ignore) => {
    if (!isTrustedSender(event, getDesktopLyricsWindow())) return;
    const window = getDesktopLyricsWindow();
    if (window && !window.isDestroyed()) {
      window.setIgnoreMouseEvents(ignore === true, { forward: true });
    }
  });

  ipcMain.on(IPC.DESKTOP_LYRICS_BOUNDS, (event, bounds) => {
    if (!isTrustedSender(event, getDesktopLyricsWindow())) return;
    const window = getDesktopLyricsWindow();
    if (!window || window.isDestroyed() || !bounds || typeof bounds !== 'object') return;
    const clamp = (value, fallback) => {
      const num = Number(value);
      return Number.isFinite(num) ? num : fallback;
    };
    const current = window.getBounds();
    window.setBounds({
      x: clamp(bounds.x, current.x),
      y: clamp(bounds.y, current.y),
      width: clamp(bounds.width, current.width),
      height: clamp(bounds.height, current.height)
    });
  });

  ipcMain.on(IPC.DESKTOP_LYRICS_FIXED_SIZE, (event, payload) => {
    if (!isTrustedSender(event, getDesktopLyricsWindow())) return;
    const window = getDesktopLyricsWindow();
    if (!window || window.isDestroyed()) return;
    const area = screen.getPrimaryDisplay().workArea;
    if (payload?.fixed) {
      const width = Math.max(800, Math.round(Number(payload.width) || area.width));
      const height = Math.max(160, Math.round(Number(payload.height) || 160));
      window.setMaximumSize(Math.min(width, area.width), Math.min(height, area.height));
    } else {
      window.setMaximumSize(area.width, area.height);
    }
  });

  ipcMain.handle(IPC.DESKTOP_LYRICS_POINTER_STATE, (event) => {
    if (!isTrustedSender(event, getDesktopLyricsWindow())) return null;
    const window = getDesktopLyricsWindow();
    if (!window || window.isDestroyed()) return null;
    return {
      cursor: screen.getCursorScreenPoint(),
      bounds: window.getBounds()
    };
  });

  // 频谱数据面通道保持既有信任集合不变（any = 三窗口之一）：
  // 频谱链路敏感，本次只收紧危险通道，不惊动频谱
  ipcMain.on(IPC.SPECTRUM_UPDATE, (event, payload) => {
    if (!trustedInScope(event, 'any')) return;
    sendSpectrumData(sanitizeSpectrumPayload(payload));
  });

  ipcMain.on(IPC.SPECTRUM_HUD_READY, (event) => {
    if (!trustedInScope(event, 'any')) return;
    const settings = getSettings();
    sendSpectrumSettings({ ...settings, scale: 1 });
    const main = windows.main();
    if (main && !main.isDestroyed()) {
      main.webContents.send('spectrum:request-current');
    }
  });

  ipcMain.on(IPC.SPECTRUM_LOCK_TOGGLE, (event, value) => {
    if (!trustedInScope(event, 'any')) return;
    updateSettings({ spectrumLocked: value === true });
    syncSpectrumHudSettings(getSettings());
  });

  // 解锁态的拖动：渲染层算好新 bounds，主进程 setBounds（CSS drag region 在
  // 高 DPI 缩放屏上 hit-test 不可靠，桌面歌词窗口同款方案）。
  // 只写提供的字段：宽高跟着写回会在 150% 缩放的 DIP↔物理往返中 ±1 漂移
  ipcMain.on(IPC.SPECTRUM_BOUNDS, (event, bounds) => {
    if (!isTrustedSender(event, getSpectrumWindow())) return;
    const window = getSpectrumWindow();
    if (!window || window.isDestroyed() || !bounds || typeof bounds !== 'object') return;
    const next = {};
    for (const key of ['x', 'y', 'width', 'height']) {
      const num = Number(bounds[key]);
      if (Number.isFinite(num)) next[key] = Math.round(num);
    }
    if (Object.keys(next).length) window.setBounds(next);
  });

  // 设置页「重置频谱位置」：清拖动记录回到默认锚点（主窗口发起）
  ipcMain.on(IPC.SPECTRUM_RESET_POSITION, (event) => {
    if (!trustedInScope(event, 'any')) return;
    resetSpectrumHudPosition();
  });

  // 锁定切换握手：渲染层呈现空帧后回报，此刻 setBounds 才无旧内容可闪
  ipcMain.on(IPC.SPECTRUM_GEOMETRY_READY, (event) => {
    if (!isTrustedSender(event, getSpectrumWindow())) return;
    flushSpectrumGeometry();
  });

  ipcMain.on(IPC.WINDOW_DOCK_TOGGLE, (event) => {
    if (!trustedInScope(event, 'main')) return;
    toggleMainWindowDock();
  });

  ipcMain.handle(IPC.WINDOW_DOCK_GET, (event) => {
    assertTrusted(event, 'main');
    return isMainWindowDocked();
  });

  ipcMain.on(IPC.WINDOW_RESTORE, (event) => {
    if (!trustedInScope(event, 'main')) return;
    restoreMainWindow();
  });

  ipcMain.on(IPC.WINDOW_ANIMATE_POSITION, (event, pos) => {
    if (!trustedInScope(event, 'main')) return;
    applyAnimatePosition(Number(pos?.x), Number(pos?.y));
  });

  ipcMain.on(IPC.WINDOW_ANIMATE_DONE, (event) => {
    if (!trustedInScope(event, 'main')) return;
    finishAnimate();
  });

  ipcMain.on(IPC.WINDOW_MOVE, (event, position) => {
    if (!trustedInScope(event, 'main')) return;
    moveMainWindow(Number(position?.x), Number(position?.y), Number(position?.movedX) || 0);
  });

  ipcMain.on(IPC.WINDOW_DRAG_END, (event) => {
    if (!trustedInScope(event, 'main')) return;
    finishMainWindowDrag();
  });

  // 拖拽会话存活：RShift 热键据此决定「轻推后交还拖拽」还是正常收起/呼出
  ipcMain.on(IPC.WINDOW_DRAG_ACTIVE, (event, active) => {
    if (!trustedInScope(event, 'main')) return;
    setMainWindowDragActive(active === true);
  });

  // 渲染层轻推手势结束（完成或被取消）：清动画态与轻推标志，交还常规拖拽
  ipcMain.on(IPC.WINDOW_NUDGE_DONE, (event) => {
    if (!trustedInScope(event, 'main')) return;
    finishWindowNudge();
  });

  ipcMain.handle(IPC.WINDOW_GET_BOUNDS, (event) => {
    assertTrusted(event, 'main');
    return getMainWindowBounds();
  });

  ipcMain.handle(IPC.UPDATE_GET, (event) => {
    assertTrusted(event, 'main');
    return getUpdateState();
  });

  ipcMain.handle(IPC.UPDATE_CHECK, async (event) => {
    assertTrusted(event, 'main');
    return checkForUpdates();
  });

  ipcMain.handle(IPC.UPDATE_DOWNLOAD, async (event) => {
    assertTrusted(event, 'main');
    return downloadUpdate();
  });

  ipcMain.handle(IPC.UPDATE_INSTALL, (event) => {
    assertTrusted(event, 'main');
    installUpdate();
    return true;
  });
};
