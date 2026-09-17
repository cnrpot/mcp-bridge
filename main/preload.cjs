const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('desktop',{call:(action,payload)=>ipcRenderer.invoke('desktop:call',action,payload),subscribe:fn=>{const listener=(_,state)=>fn(state);ipcRenderer.on('desktop:state',listener);return()=>ipcRenderer.removeListener('desktop:state',listener);}});
