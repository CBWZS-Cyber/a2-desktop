// 预加载：按窗口角色暴露最小桥。
//   桌宠窗（file://）→ window.pet：拖拽 / 点击 / 菜单
//   主窗（http(s)://）→ window.a2desktop：桌宠显隐 + 关闭行为设置
// 主窗加载的是远端页面，只给它需要的三项，不把桌宠的控制面全暴露出去。
const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('pet', {
    openMain: () => ipcRenderer.send('pet:open-main'),
    dragStart: () => ipcRenderer.send('pet:drag-start'),
    dragEnd: () => ipcRenderer.send('pet:drag-end'),
    menu: () => ipcRenderer.send('pet:menu'),
    settled: () => ipcRenderer.send('pet:settled'),
    hit: (isHit) => ipcRenderer.send('pet:hit', !!isHit),
  });
} else {
  contextBridge.exposeInMainWorld('a2desktop', {
    getSettings: () => ipcRenderer.invoke('desktop:get-settings'),
    setPetVisible: (v) => ipcRenderer.invoke('desktop:set-pet-visible', !!v),
    setCloseAction: (a) => ipcRenderer.invoke('desktop:set-close-action', String(a || '')),
  });
}
