const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('maatiWidget', {
  setInputRegions: (regions) => ipcRenderer.send('widget:set-input-regions', regions),
  getScreenTime: () => ipcRenderer.invoke('screen-time:get'),
  resetScreenTime: () => ipcRenderer.invoke('screen-time:reset'),
  startDim: (durationMs) => ipcRenderer.invoke('screen-dim:start', durationMs),
  stopDim: () => ipcRenderer.invoke('screen-dim:stop'),
  verifyBreak: () => ipcRenderer.invoke('break:verify'),
  focusBreakCompanion: () => ipcRenderer.invoke('widget:focus'),
  openProfile: (route) => ipcRenderer.invoke('profile:open', route),
  onScreenTimeUpdate: (callback) => {
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on('screen-time:update', listener);
    return () => ipcRenderer.removeListener('screen-time:update', listener);
  },
});
