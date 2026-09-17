// Explicit local test mode. Never used without isolated profile/output paths.
module.exports=async({win,action,bridge,rt,app})=>{
 const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict'),{dialog,safeStorage}=require('electron');
 const base=process.env.MCPGO_DESKTOP_SMOKE_DIR,phase=process.env.MCP_BRIDGE_RESTART_TEST;const original=dialog.showMessageBox;
 const pause=ms=>new Promise(r=>setTimeout(r,ms));const js=c=>win.webContents.executeJavaScript(c);
 const until=async fn=>{for(let i=0;i<120;i++){if(await fn())return;await pause(100);}throw Error('Restart UI did not update');};
 const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
 try{
  assert(base&&path.isAbsolute(base));assert(['write','read'].includes(phase));assert(safeStorage.isEncryptionAvailable(),'Encrypted token persistence unavailable on this machine');fs.mkdirSync(base,{recursive:true});
  dialog.showMessageBox=async()=>({response:1});
  if(phase==='write'){
   const root=path.join(base,'workspace');fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,'restart.txt'),'restart-before');rt.config.root=root;
   await action('settings',{port:18794,tunnelProvider:'none',permissions:{edit:true,execute:true},extraInstructions:'restart-fixture-setting'});await action('start');
   const rpc=async(method,params={})=>{const r=await fetch(bridge.url(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});assert.equal(r.status,200);return (await r.json()).result;};
   await rpc('initialize');await fetch(bridge.url(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})});await rpc('tools/list');
   for(const [name,args] of [['list_skills',{}],['read_files',{paths:['restart.txt']}],['apply_patch',{file_path:'restart.txt',content:'restart-after'}],['run_command',{command:'Write-Output "restart-job-done"',timeout_ms:10000}]]){const result=await rpc('tools/call',{name,arguments:args});assert(!result.isError,JSON.stringify(result));}
   const state=await action('state');assert.equal(state.history.length,1);assert.equal(state.jobs.length,1);
   await action('approvalMode',{mode:'full'});
   fs.writeFileSync(path.join(base,'restart-proof.json'),JSON.stringify({root,id:state.history[0].id,tokenHash:digest(bridge.token)}));
   fs.writeFileSync(path.join(base,'restart-write.json'),JSON.stringify({ok:true,packaged:app.isPackaged,version:app.getVersion(),checks:['real patch and task created','settings saved','token fingerprint saved without credential']}));
  }else{
   const proof=JSON.parse(fs.readFileSync(path.join(base,'restart-proof.json'),'utf8'));let state=await action('state');assert.equal(state.config.root,proof.root);assert.equal(state.config.port,18794);assert.equal(state.config.extraInstructions,'restart-fixture-setting');assert.equal(state.jobs.length,0);assert.equal(state.history.length,1);assert.equal(state.history[0].id,proof.id);
   assert.equal(state.config.approvalMode,'full');assert.equal(state.config.fullAccessAcknowledged,true);await action('approvalMode',{mode:'manual'});assert.equal((await action('state')).config.permissions.capture,false);
   await action('start');assert.equal(digest(bridge.token),proof.tokenHash);
   await js("document.querySelector('[data-view=history]').click();true");await until(()=>js(`!!document.querySelector('[data-revision="${proof.id}"]')`));
   await js(`document.querySelector('[data-revision="${proof.id}"]').click();true`);await until(()=>js("document.querySelector('#detailDialog').open"));assert.match(await js("document.querySelector('#detailBody').textContent"),/restart-before/);
   await js("document.querySelector('#closeDialog').click();true");await js(`document.querySelector('[data-restore="${proof.id}"]').click();true`);
   await until(async()=>/已恢复/.test(await js("document.querySelector('#historyList').textContent")));assert.equal(fs.readFileSync(path.join(proof.root,'restart.txt'),'utf8'),'restart-before');
   win.show();win.focus();await pause(500);fs.writeFileSync(path.join(base,'restart-history.png'),(await win.webContents.capturePage()).toPNG());
   fs.writeFileSync(path.join(base,'restart-result.json'),JSON.stringify({ok:true,packaged:app.isPackaged,version:app.getVersion(),checks:['confirmed full mode persists and previous permissions restore on exit','workspace and settings persist across process restart','encrypted credential retained','completed tasks clear as documented','file history persists','history diff opens after restart','UI restore updates file and history after restart'],confirmationMode:'isolated fixture automatically answers confirmation API'},null,2));
  }
  dialog.showMessageBox=original;console.log('RESTART_'+phase.toUpperCase()+'_OK');app.quit();
 }catch(e){dialog.showMessageBox=original;fs.mkdirSync(base,{recursive:true});fs.writeFileSync(path.join(base,'restart-error.json'),JSON.stringify({ok:false,phase,error:e.stack}));console.error(e.stack);app.exit(1);}
};
