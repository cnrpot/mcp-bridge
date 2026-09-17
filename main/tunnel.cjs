const fs=require('fs');const {spawn}=require('child_process');const {killProcessTree}=require('../core/shell');
class Tunnel{
 constructor(changed){this.child=null;this.url='';this.status='off';this.changed=changed;this.lastError='';}
 async start(exe,port){if(this.child)throw Error('Tunnel is already running');if(!fs.existsSync(exe))throw Error('Bundled cloudflared was not found');this.status='connecting';this.lastError='';this.changed();
  const child=spawn(exe,['tunnel','--no-autoupdate','--url',`http://127.0.0.1:${port}`],{windowsHide:true,stdio:['ignore','pipe','pipe']});this.child=child;
  return new Promise((resolve,reject)=>{let ready=false,buf='';const timeout=setTimeout(()=>{if(!ready){this.lastError='连接超时，请检查网络；本地 MCP 仍可使用';this.stop().then(()=>reject(Error(this.lastError)));}},60000);
   const receive=data=>{buf=(buf+data.toString()).slice(-10000);const match=buf.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);if(match&&!this.url){this.url=match[0];this.changed();}if(this.url&&!ready&&/Registered tunnel connection/i.test(buf)){ready=true;clearTimeout(timeout);this.status='online';this.changed();resolve(this.url);}};
   child.stdout.on('data',receive);child.stderr.on('data',receive);
   child.once('error',e=>{clearTimeout(timeout);this.lastError=e.message;this.status='error';this.child=null;this.changed();reject(e);});
   child.once('close',()=>{clearTimeout(timeout);if(this.child===child){this.child=null;this.url='';this.status='off';this.changed();}if(!ready)reject(Error('Cloudflare 隧道退出；请检查网络或稍后重试'));});
  });
 }
 async stop(){const c=this.child;this.child=null;this.url='';this.status='off';if(c)await killProcessTree(c);this.changed();}
}
module.exports=Tunnel;
