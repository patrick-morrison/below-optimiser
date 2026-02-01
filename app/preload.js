const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    optimise: (filePath) => ipcRenderer.invoke('optimise-model', filePath),
    saveFile: (filePath) => ipcRenderer.invoke('save-file', filePath),
    getPathForFile: (file) => webUtils.getPathForFile(file)
});
