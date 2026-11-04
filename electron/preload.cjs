const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jello', {
  info: () => ipcRenderer.invoke('app:info')
});
