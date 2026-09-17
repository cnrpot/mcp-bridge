// Explicit developer smoke mode, enabled only by the launching user's environment.
module.exports=async({win,action,bridge,rt,app})=>{
 const fs=require('fs'),path=require('path'),assert=require('assert/strict');const base=process.env.MCPGO_DESKTOP_SMOKE_DIR;
 try{
  if(!base||!path.isAbsolute(base))throw Error('Absolute smoke output folder required');fs.mkdirSync(base,{recursive:true});const root=path.join(base,'workspace');fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,'hello.txt'),'Desktop smoke fixture');
  rt.config.root=root;rt.config.port=18789;rt.config.tunnelProvider='none';rt.changed();await new Promise(r=>setTimeout(r,500));
  const errors=[];win.webContents.on('console-message',(details,level,message)=>{const severity=details.level??level;const text=details.message??message;if(severity==='error'||severity===2||severity===3)errors.push(text);});
  await win.webContents.executeJavaScript("document.getElementById('startStop').click(); true");
  const deadline=Date.now()+10000;while(!bridge.server&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));assert(bridge.server,'Start button must start the real server');
  const rpc=async(method,params={})=>{const r=await fetch(bridge.url(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});assert.equal(r.status,200);return r.json();};
  const hello=await rpc('initialize',{protocolVersion:'2025-06-18'});assert.equal(hello.result.serverInfo.name,'mcp-bridge');const listing=await rpc('tools/list');assert.equal(listing.result.tools.length,30);
  const read=await rpc('tools/call',{name:'read_files',arguments:{paths:['hello.txt']}});assert.match(read.result.content[0].text,/Desktop smoke fixture/);
  const denied=await rpc('tools/call',{name:'run_command',arguments:{command:'echo should-not-run'}});assert.equal(denied.result.isError,true);
  const search=await rpc('tools/call',{name:'search_files',arguments:{query:'Desktop',include:'**/*.txt'}});assert(!search.result.isError,'Packaged search worker must run');
  await rpc('tools/call',{name:'set_todos',arguments:{todos:[{id:'smoke',title:'MCP 握手与工具验证',status:'completed'}]}});
  await rpc('tools/call',{name:'report_progress',arguments:{message:'桌面窗口、连接服务与权限拒绝已验证',percent:100}});
  await new Promise(r=>setTimeout(r,500));
  assert.match(await win.webContents.executeJavaScript("document.getElementById('statusBadge').textContent"),/已连接/);
  console.log('SMOKE: API and UI assertions passed; capturing application window');
  win.show(); win.focus(); await new Promise(r=>setTimeout(r,700));
  const image=await win.webContents.capturePage();fs.writeFileSync(path.join(base,'desktop-overview.png'),image.toPNG());
  for(const view of ['tools','jobs','history','settings']){await win.webContents.executeJavaScript(`document.querySelector('[data-view="${view}"]').click(); true`);await new Promise(r=>setTimeout(r,150));assert.equal(await win.webContents.executeJavaScript(`document.getElementById('view-${view}').classList.contains('hidden')`),false);}
  await win.webContents.executeJavaScript("document.querySelector('[data-view=overview]').click(); document.getElementById('startStop').click(); true");
  const end=Date.now()+10000;while(bridge.server&&Date.now()<end)await new Promise(r=>setTimeout(r,100));assert(!bridge.server,'Stop button must stop the real server');
  if(errors.length)throw Error('Renderer errors: '+errors.join('; '));
  fs.writeFileSync(path.join(base,'smoke-result.json'),JSON.stringify({ok:true,checks:['UI start/stop','MCP handshake','30-tool discovery','read file','execute denied by default','search worker','five navigation views','renderer without console errors'],packaged:app.isPackaged},null,2));
  console.log('DESKTOP_SMOKE_OK');app.quit();
 }catch(e){if(base)fs.writeFileSync(path.join(base,'smoke-result.json'),JSON.stringify({ok:false,error:e.stack},null,2));console.error(e.stack);app.exit(1);}
};
