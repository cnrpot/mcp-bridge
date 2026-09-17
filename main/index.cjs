const {app,BrowserWindow,ipcMain,dialog,clipboard,shell,safeStorage,desktopCapturer,Tray,Menu,nativeImage}=require('electron');
const fs=require('fs');const path=require('path');const crypto=require('crypto');
app.setName('mcp-bridge');
// Stable software composition on Windows remote/virtual desktops. No GPU is needed for this control panel.
app.disableHardwareAcceleration();
app.setPath('userData',process.env.MCPGO_DESKTOP_TEST_DATA?path.resolve(process.env.MCPGO_DESKTOP_TEST_DATA):path.join(app.getPath('appData'),'MCPGO Desktop'));
const gotLock=app.requestSingleInstanceLock();if(!gotLock){app.quit();}else{
let win,tray,rt,bridge,tunnel,token,history,exec;let busy=false,quitting=false,pending=0,modeChanging=false;let updater;let activities=[];let saveTimer;
const asset=n=>path.join(__dirname,'..','assets',n);
function show(){if(win){win.show();if(win.isMinimized())win.restore();win.focus();}}
app.on('second-instance',show);
const file=()=>path.join(app.getPath('userData'),'settings.json');
function save(){const cfg={...rt.config};if(safeStorage.isEncryptionAvailable())cfg.encryptedToken=safeStorage.encryptString(token).toString('base64');fs.mkdirSync(path.dirname(file()),{recursive:true});const tmp=file()+'.tmp';fs.writeFileSync(tmp,JSON.stringify(cfg,null,2),{mode:0o600});fs.renameSync(tmp,file());}
function state(){if(!rt)return {};return {config:{...rt.config},running:!!bridge?.server,busy,modeChanging,updates:updater?.snapshot(),localUrl:bridge?.url()||'',publicUrl:bridge?.server&&tunnel?.url?tunnel.url+'/mcp/'+token:'',tunnelStatus:tunnel?.status||'off',tunnelError:tunnel?.lastError||'',tools:require('../core/tools').list().map(t=>({name:t.name,description:t.description,capability:require('../core/policy').capability(t.name)})),jobs:exec?[...exec.commands.values()].map(j=>({id:j.id,command:j.command,cwd:j.cwd,running:j.running,exitCode:j.exitCode,time:j.startedAt,cancelled:!!j.cancelled,endedAt:j.endedAt})).reverse():[],history:history?history.summaries(rt.config.root):[],activities,todos:rt.todos,progress:rt.progress,version:app.getVersion()};}
function emit(){if(win&&!win.isDestroyed())win.webContents.send('desktop:state',state());}
async function confirm(request){if(pending>=4)return false;pending++;show();try{const {response}=await dialog.showMessageBox(win,{type:'warning',title:'mcp-bridge · 本地授权',message:request.kind==='mode'?'更改审批模式':request.kind==='update'?'安装应用更新':request.kind==='edit'?'确认远程文件修改':request.kind==='capture'?'确认屏幕内容共享':'确认命令操作',detail:request.message,buttons:['拒绝','允许一次'],defaultId:0,cancelId:0,noLink:true});return response===1;}finally{pending--;}}
async function capture(args={}){const epoch=rt.epoch;require('../core/policy').ensureAllowed('screenshot');if(!args.preConfirmed&&require('../core/approval').needs('capture')&&!await confirm({kind:'capture',message:`原因：${args.reason||'未提供'}\n截图会发送给远程 AI，可能包含敏感信息。`}))throw Error('[user refused] Screenshot not taken');require('../core/policy').ensureAllowed('screenshot');
 if(rt.epoch!==epoch)throw Error('Bridge stopped during screenshot confirmation');
 const sources=await desktopCapturer.getSources({types:args.window?['window']:['screen'],thumbnailSize:{width:1600,height:1000},fetchWindowIcons:false});let selected=sources;
 if(args.window){
  const matches=await new Promise((resolve,reject)=>{const w=new(require('worker_threads').Worker)(path.join(__dirname,'window-match.cjs'),{workerData:{pattern:args.window,names:sources.map(s=>s.name)}});const timer=setTimeout(()=>{w.terminate();reject(Error('Window pattern exceeded its time budget'));},2000);w.once('message',r=>{clearTimeout(timer);w.terminate();r.error?reject(Error(r.error)):resolve(r);});w.once('error',e=>{clearTimeout(timer);reject(e);});});
  selected=matches.slice(0,1).map(i=>sources[i]);
 }
 if(rt.epoch!==epoch)throw Error('Mode or connection changed during capture');if(!selected.length)throw Error('No capturable screen/window matched');return selected.slice(0,4).flatMap(s=>{if(s.thumbnail.isEmpty())throw Error('Screen capture is unavailable or blocked by the OS');return [{type:'text',text:s.name},{type:'image',mimeType:'image/jpeg',data:s.thumbnail.toJPEG(80).toString('base64')}];});}
async function stop(){rt.epoch=(rt.epoch||0)+1;await bridge.stop();await tunnel.stop();if(quitting)await exec.disposeAll();else await exec.stopAll();emit();}
async function action(name,p={}){
 switch(name){
  case 'state':return state();
  case 'chooseRoot':if(bridge.server||busy||modeChanging||require('../core/tools').busy())throw Error('请先停止连接并等待工具调用结束再切换工作区');{const r=await dialog.showOpenDialog(win,{title:'选择允许 AI 访问的工作目录',properties:['openDirectory']});if(!r.canceled){await exec.disposeAll();activities=[];rt.todos=[];rt.progress=null;rt.config.root=fs.realpathSync(r.filePaths[0]);save();emit();}return state();}
  case 'settings':{if(!p||typeof p!=='object')throw Error('Invalid settings');const cfg=rt.config;if(modeChanging)throw Error('请先完成模式确认');
   if(p.permissions&&require('../core/approval').mode()==='full')throw Error('完全访问已开启全部权限，请先切换审批模式');
   if(p.permissions){for(const k of ['read','edit','execute','capture'])if(typeof p.permissions[k]==='boolean'){if(k==='execute'&&p.permissions[k]&&!cfg.permissions.execute&&!await confirm({kind:'execute',message:'开启 Execute 后，远程命令拥有当前 Windows 用户的系统权限，不是工作目录沙箱。只向可信客户端分享连接地址。'}))continue;cfg.permissions[k]=p.permissions[k];}}
   if(p.port!==undefined){if(bridge.server)throw Error('请先停止服务再修改端口');if(!Number.isInteger(p.port)||p.port<1024||p.port>65535)throw Error('端口范围为 1024–65535');cfg.port=p.port;}
   for(const k of ['closeToTray','autoCheckUpdates'])if(typeof p[k]==='boolean')cfg[k]=p[k];
   if(p.tunnelProvider!==undefined){if(bridge.server)throw Error('请先停止服务再切换连接方式');if(!['none','cloudflared'].includes(p.tunnelProvider))throw Error('Unknown connection mode');cfg.tunnelProvider=p.tunnelProvider;}
   for(const k of ['dotnetPath','godotPath','extraInstructions'])if(typeof p[k]==='string'){if(p[k].length>8000)throw Error('Setting is too long');cfg[k]=p[k];}
   save();emit();return state();}
  case 'start':if(busy)throw Error('正在处理连接操作');busy=true;emit();try{await bridge.start(rt.config.port,token);if(rt.config.tunnelProvider==='cloudflared'){try{const exe=app.isPackaged?path.join(process.resourcesPath,'bin','cloudflared.exe'):path.join(__dirname,'..','vendor','cloudflared.exe');const url=await tunnel.start(exe,bridge.port);bridge.publicHost=new URL(url).host;}catch(e){tunnel.lastError=e.message;}}}finally{busy=false;emit();}return state();
  case 'stop':if(busy)throw Error('请等待当前连接操作完成');busy=true;emit();try{await stop();}finally{busy=false;emit();}return state();
  case 'rotateToken':if(busy||bridge.server)throw Error('请先停止服务');token=crypto.randomBytes(24).toString('hex');save();return state();
  case 'copyUrl':{const url=p.public?state().publicUrl:state().localUrl;if(!url)throw Error('连接尚未就绪');clipboard.writeText(url);return true;}
  case 'copyPrompt':{const s=state();const url=s.publicUrl||s.localUrl;if(!url)throw Error('请先启动连接');clipboard.writeText(`通过 POST JSON-RPC 连接 MCP：${url}\n先发送 initialize 读取使用规则，再发 notifications/initialized 和 tools/list。遵守当前审批模式与权限，文件范围以 initialize 返回的规则为准，不绕过拒绝。`);return true;}
  case 'testConnection':{if(!bridge.server)throw Error('请先启动连接');const r=await fetch(bridge.url(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});if(!r.ok)throw Error('本地握手失败');const b=await r.json();return {count:b.result.tools.length};}
  case 'guide':if(!bridge.server)throw Error('请先启动连接');await shell.openExternal(bridge.url().replace('/mcp/','/guide/'));return true;
  case 'jobOutput':{const j=exec.commands.get(String(p.id));if(!j)throw Error('任务记录已过期');return exec.renderRecord(j,false);}
  case 'cancelJob':await exec.stopCommand(String(p.id));emit();return true;
  case 'jobInput':{const j=exec.commands.get(String(p.id));if(!j?.running||!j.child.stdin.writable)throw Error('任务没有可写输入');if(typeof p.input!=='string'||p.input.length>10000)throw Error('Invalid input');j.child.stdin.write(p.input+'\n');return true;}
  case 'historyDetail':{const h=history.get(p.id);if(h&&!history.sameRoot(h.root,rt.config.root))throw Error('找不到变更记录');if(!h)throw Error('找不到变更记录');return h;}
  case 'restore':{if(require('../core/tools').busy())throw Error('请等待正在执行的工具完成');const epoch=rt.epoch,root=rt.config.root;
   const h=history.get(String(p.id));if(!h||!history.sameRoot(h.root,root)||h.restored)throw Error('找不到可恢复的变更记录');
   if(!await confirm({kind:'edit',message:'恢复所选变更之前的文件内容？如文件后来又有修改，将拒绝覆盖。'}))return false;
   if(rt.epoch!==epoch||rt.config.root!==root)throw Error('连接状态或工作区已变化，请重新查看记录后恢复');
   if(require('../core/tools').busy())throw Error('请等待正在执行的工具完成');return history.restore(String(p.id));}
  case 'approvalMode':{
   const approval=require('../core/approval');if(!approval.modes.includes(p.mode))throw Error('未知审批模式');if(modeChanging||busy)throw Error('正在处理连接或模式切换');if(p.mode===approval.mode())return state();
   modeChanging=true;emit();const epoch=rt.epoch,root=rt.config.root;
   try{if(p.mode!=='manual'){
    const message=p.mode==='full'?'完全访问将开启读取、修改、执行和截图，取消逐次审批。文件工具可访问工作目录之外的系统文件、网络路径等当前 Windows 用户有权访问的位置；命令仍拥有当前用户系统权限，不提升管理员权限。截图可能包含敏感信息。只对可信客户端使用。切换模式不会停止已启动的命令。':'自动审批会自动批准已授权的常规文件修改和命令。命中风险规则的命令、截图仍需确认。规则无法识别全部危险操作，这不是系统沙箱。';
    if(!await confirm({kind:'mode',message})){modeChanging=false;return state();}if(rt.epoch!==epoch||rt.config.root!==root)throw Error('连接或工作目录已变化，请重新选择模式');
   }approval.apply(p.mode);save();modeChanging=false;emit();return state();}finally{modeChanging=false;emit();}
  }
  case 'checkUpdates':return updater.check();
  case 'downloadUpdate':return updater.download();
  case 'cancelUpdate':updater.cancel();return true;
  case 'updateReleasePage':await shell.openExternal(updater.snapshot().releasePage);return true;
  case 'installUpdate':{
   const canInstall=()=>!busy&&!modeChanging&&!require('../core/tools').busy()&&![...exec.commands.values()].some(j=>j.running);
   if(!app.isPackaged||process.platform!=='win32')throw Error('仅打包后的 Windows 应用支持启动更新安装');
   if(!canInstall()||pending)throw Error('请先停止运行任务并完成待审批操作，再安装更新');
   if(!await confirm({kind:'update',message:'将退出 mcp-bridge 并打开新版 Windows 安装向导。安装包已与 GitHub 发布资产进行 SHA256 核对，但尚未代码签名。免安装用户若不希望安装，请取消并从发布页下载 ZIP。是否继续？'}))return false;
   if(!canInstall()||pending)throw Error('当前有新的任务或审批，请稍后安装');
   const file=await updater.prepareInstall();if(!canInstall()||pending)throw Error('当前有新的任务或审批，请稍后安装');
   busy=true;emit();try{await stop();if(require('../core/tools').busy())throw Error('请等待工具调用结束后重试');await updater.prepareInstall();
    const child=require('child_process').spawn(file,[],{detached:true,stdio:'ignore'});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();quitting=true;await exec.disposeAll();tray?.destroy();app.quit();return true;
   }finally{busy=false;emit();}
  }
  case 'clearActivity':activities=[];emit();return true;
  default:throw Error('Unsupported desktop action');
 }
}
app.whenReady().then(async()=>{
 rt=require('../core/runtime');rt.dataDir=app.getPath('userData');
 let stored={};try{stored=JSON.parse(fs.readFileSync(file(),'utf8'));}catch{}
 const defaults=rt.config;rt.config={...defaults,...stored,permissions:{...defaults.permissions,...stored.permissions}};delete rt.config.encryptedToken;require('../core/approval').normalize(rt.config);
 if(rt.config.root&&!fs.existsSync(rt.config.root))rt.config.root='';
 try{token=stored.encryptedToken?safeStorage.decryptString(Buffer.from(stored.encryptedToken,'base64')):'';}catch{}if(!token)token=crypto.randomBytes(24).toString('hex');
 rt.confirm=confirm;rt.capture=capture;rt.changed=()=>{if(!saveTimer)saveTimer=setTimeout(()=>{saveTimer=null;emit();},80);};rt.activity=e=>{activities.unshift({...e,time:Date.now(),id:crypto.randomUUID()});activities=activities.slice(0,200);rt.changed();};
 history=require('../core/history');exec=require('../core/tools-exec');bridge=new(require('../core/server').Bridge)();tunnel=new(require('./tunnel.cjs'))(()=>{if(bridge)bridge.publicHost=tunnel?.url?new URL(tunnel.url).host:'';emit();});
 updater=new(require('./updater.cjs').Updater)({currentVersion:app.getVersion(),dataDir:app.getPath('userData'),onChange:()=>rt.changed()});
 win=new BrowserWindow({width:1240,height:860,minWidth:960,minHeight:700,title:'mcp-bridge',icon:asset('icon.png'),backgroundColor:'#f3f6fa',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());win.webContents.session.setPermissionRequestHandler((_,__,cb)=>cb(false));win.webContents.session.setPermissionCheckHandler(()=>false);
 ipcMain.handle('desktop:call',async(event,name,payload)=>{if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame)throw Error('Untrusted IPC sender');return action(name,payload);});
 win.on('close',e=>{if(!quitting&&rt.config.closeToTray&&tray){e.preventDefault();win.hide();}});
 tray=new Tray(asset('icon.png'));tray.setToolTip('mcp-bridge');tray.setContextMenu(Menu.buildFromTemplate([{label:'打开控制台',click:show},{label:'退出并停止所有任务',click:()=>app.quit()}]));tray.on('double-click',show);
 await win.loadFile(path.join(__dirname,'..','ui','index.html'));save();setInterval(emit,2000).unref();
 const autoCheck=()=>{if(rt.config.autoCheckUpdates&&!updater.busy())updater.check().catch(()=>{});};if(!process.env.MCPGO_DESKTOP_TEST_DATA){setTimeout(autoCheck,10000).unref();setInterval(autoCheck,6*60*60*1000).unref();}
 if(process.env.MCP_BRIDGE_FEATURE_TEST==='1'&&process.env.MCPGO_DESKTOP_TEST_DATA&&process.env.MCPGO_DESKTOP_SMOKE_DIR)require('./feature-test.cjs')({win,action,bridge,rt,app,updater});
 else if(process.env.MCP_BRIDGE_RESTART_TEST&&process.env.MCPGO_DESKTOP_TEST_DATA&&process.env.MCPGO_DESKTOP_SMOKE_DIR)require('./restart-test.cjs')({win,action,bridge,rt,app});
 else if(process.env.MCP_BRIDGE_FLOW_TEST==='1'&&process.env.MCPGO_DESKTOP_TEST_DATA&&process.env.MCPGO_DESKTOP_SMOKE_DIR)require('./flow-test.cjs')({win,action,bridge,rt,app});
 else if(process.env.MCPGO_DESKTOP_SMOKE==='1')require('./smoke.cjs')({win,action,bridge,rt,app});
});
app.on('before-quit',e=>{if(!quitting){e.preventDefault();quitting=true;updater?.cancel();Promise.resolve(rt?stop():null).finally(()=>{tray?.destroy();app.quit();});}});
app.on('window-all-closed',()=>app.quit());
}
