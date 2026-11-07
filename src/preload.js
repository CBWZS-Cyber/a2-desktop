// 预加载：桌宠窗与主进程之间的最小桥
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pet', {
  openMain: () => ipcRenderer.send('pet:open-main'),
  dragStart: () => ipcRenderer.send('pet:drag-start'),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  menu: () => ipcRenderer.send('pet:menu'),
  settled: () => ipcRenderer.send('pet:settled'),
  hit: (isHit) => ipcRenderer.send('pet:hit', !!isHit),
});
