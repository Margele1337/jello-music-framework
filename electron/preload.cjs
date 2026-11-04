const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jello', {
  app: {
    // 设置页页脚展示「V{version} - {platform}」用，非 IPC（直接读进程常量）
    platform: process.platform,
    getVersion: () => ipcRenderer.invoke('app:version'),
    openLogs: () => ipcRenderer.invoke('app:open-logs'),
    // 导出脱敏日志副本：主进程弹保存框，返回 { ok, path } 或 { ok:false, canceled:true }
    exportLogs: () => ipcRenderer.invoke('app:export-logs'),
    // GPU 开关等「需重启」设置的确认入口，由用户在 UI 上主动触发
    restart: () => ipcRenderer.invoke('app:restart'),
    // 启动意图（跳转列表 --settings）：挂载后拉取一次即清空
    consumeLaunchIntent: () => ipcRenderer.invoke('app:launch-intent')
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
    onChange: (callback) => {
      const handler = (_event, settings) => callback(settings);
      ipcRenderer.on('settings:changed', handler);
      return () => ipcRenderer.removeListener('settings:changed', handler);
    }
  },
  library: {
    getTracks: () => ipcRenderer.invoke('library:get-tracks'),
    importFolder: () => ipcRenderer.invoke('library:import-folder'),
    rescan: () => ipcRenderer.invoke('library:rescan'),
    clear: () => ipcRenderer.invoke('library:clear'),
    resolve: (hash) => ipcRenderer.invoke('library:resolve', hash),
    lyric: (hash) => ipcRenderer.invoke('library:lyric', hash),
    getLiked: () => ipcRenderer.invoke('library:get-liked'),
    toggleLiked: (hash) => ipcRenderer.invoke('library:toggle-liked', hash),
    onProgress: (callback) => {
      const handler = (_event, progress) => callback(progress);
      ipcRenderer.on('library:progress', handler);
      return () => ipcRenderer.removeListener('library:progress', handler);
    }
  },
  desktopLyrics: {
    update: (state) => ipcRenderer.send('desktop-lyrics:update', state),
    progress: (payload) => ipcRenderer.send('desktop-lyrics:progress', payload)
  },
  player: {
    onCommand: (callback) => {
      const handler = (_event, command) => callback(command);
      ipcRenderer.on('player:command', handler);
      return () => ipcRenderer.removeListener('player:command', handler);
    }
  },
  playbackState: {
    get: () => ipcRenderer.invoke('playback-state:get'),
    // 高频写入（播放中每 5 秒 + 暂停/换歌/退出），单向 send 即可，无需回执
    save: (state) => ipcRenderer.send('playback-state:set', state)
  },
  ui: {
    onNavigate: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('ui:navigate', handler);
      return () => ipcRenderer.removeListener('ui:navigate', handler);
    }
  },
  spectrum: {
    update: (payload) => ipcRenderer.send('spectrum:update', payload),
    // 设置页「重置频谱位置」：清拖动记录回到默认锚点
    resetPosition: () => ipcRenderer.send('spectrum:reset-position'),
    onRequestCurrent: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('spectrum:request-current', handler);
      return () => ipcRenderer.removeListener('spectrum:request-current', handler);
    }
  },
  windowControl: {
    toggleDock: () => ipcRenderer.send('window:dock-toggle'),
    getDocked: () => ipcRenderer.invoke('window:dock-get'),
    restore: () => ipcRenderer.send('window:restore'),
    onDockChanged: (callback) => {
      const handler = (_event, docked) => callback(docked);
      ipcRenderer.on('window:dock-changed', handler);
      return () => ipcRenderer.removeListener('window:dock-changed', handler);
    },
    onAnimateTo: (callback) => {
      const handler = (_event, target) => callback(target);
      ipcRenderer.on('window:animate-to', handler);
      return () => ipcRenderer.removeListener('window:animate-to', handler);
    },
    onAnimateStop: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('window:animate-stop', handler);
      return () => ipcRenderer.removeListener('window:animate-stop', handler);
    },
    sendAnimatePosition: (pos) => ipcRenderer.send('window:animate-position', pos),
    sendAnimateDone: () => ipcRenderer.send('window:animate-done'),
    sendMove: (position) => ipcRenderer.send('window:move', position),
    sendDragEnd: () => ipcRenderer.send('window:drag-end'),
    // 拖拽会话存活上报：主进程 RShift 热键据此把「拖拽中收起」解释成轻推动作
    setDragActive: (active) => ipcRenderer.send('window:drag-active', active === true),
    // 侧边轻推手势：主进程下发起手帧，渲染层 rAF 驱动（与收起动画同款平滑）
    onNudgeStart: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('window:nudge-start', handler);
      return () => ipcRenderer.removeListener('window:nudge-start', handler);
    },
    sendNudgeDone: () => ipcRenderer.send('window:nudge-done'),
    getBounds: () => ipcRenderer.invoke('window:get-bounds'),
    onOverhangChanged: (callback) => {
      const handler = (_event, value) => callback(value);
      ipcRenderer.on('window:overhang-changed', handler);
      return () => ipcRenderer.removeListener('window:overhang-changed', handler);
    }
  },
  updates: {
    get: () => ipcRenderer.invoke('update:get'),
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    onState: (callback) => {
      const handler = (_event, state) => callback(state);
      ipcRenderer.on('update:state', handler);
      return () => ipcRenderer.removeListener('update:state', handler);
    }
  }
});
