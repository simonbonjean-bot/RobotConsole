// RobotConsole — pont de l'écran de démarrage
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('splash', {
  platform: process.platform,
  info: () => ipcRenderer.invoke('splash:info'),
  open: (root) => ipcRenderer.send('splash:open', root),
  blank: () => ipcRenderer.send('splash:blank'),
  restore: () => ipcRenderer.send('splash:restore'),
  pick: (mode) => ipcRenderer.invoke('splash:pick', mode),
  create: (root, name) => ipcRenderer.invoke('splash:create', root, name),
  forget: (root) => ipcRenderer.send('splash:forget', root),
  reveal: (root) => ipcRenderer.send('splash:reveal', root),
  setShow: (show) => ipcRenderer.send('splash:setShow', show),
  minimize: () => ipcRenderer.send('splash:minimize'),
  quit: () => ipcRenderer.send('splash:quit'),
});
