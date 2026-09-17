const fs=require('fs'),path=require('path'),https=require('https'),crypto=require('crypto');
const {pipeline}=require('stream/promises');const {Transform}=require('stream');
const REPO='cnrpot/mcp-bridge',API=`https://api.github.com/repos/${REPO}/releases/latest`,PAGE=`https://github.com/${REPO}/releases/latest`;
const MAX=500*1024*1024;
function version(v){const m=/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(v);if(!m)return null;const values=m.slice(1).map(Number);return values.every(Number.isSafeInteger)?values:null;}
function newer(a,b){const x=version(a),y=version(b);if(!x||!y)return false;for(let i=0;i<3;i++){if(x[i]!==y[i])return x[i]>y[i];}return false;}
function safeURL(value){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443'||!['github.com','api.github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(u.hostname))throw Error('更新地址不在允许的 GitHub HTTPS 域名内');return u;}
function open(url,signal,redirects=0){
 const u=safeURL(url);if(redirects>5)return Promise.reject(Error('更新下载重定向过多'));
 return new Promise((resolve,reject)=>{
  const req=https.get(u,{family:4,signal,headers:{'User-Agent':'mcp-bridge-update-checker','Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},timeout:30000},res=>{
   if([301,302,303,307,308].includes(res.statusCode)){res.resume();if(!res.headers.location)return reject(Error('更新下载重定向无地址'));try{resolve(open(new URL(res.headers.location,u).href,signal,redirects+1));}catch(e){reject(e);}return;}
   if(res.statusCode!==200){res.resume();return reject(Error('GitHub 更新请求失败：HTTP '+res.statusCode));}resolve(res);
  });req.on('timeout',()=>req.destroy(Error('更新网络连接超时')));req.on('error',reject);
 });
}
async function getJSON(url,signal){const res=await open(url,signal);let size=0;const chunks=[];for await(const chunk of res){size+=chunk.length;if(size>1024*1024){res.destroy();throw Error('更新信息超过大小限制');}chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
function select(release,current){
 if(!release||release.draft||release.prerelease||!version(release.tag_name)||!newer(release.tag_name,current))return null;
 const v=release.tag_name.replace(/^v/,''),name=`mcp-bridge-${v}-Setup-x64.exe`,url=`https://github.com/${REPO}/releases/download/v${v}/${name}`,page=`https://github.com/${REPO}/releases/tag/v${v}`;
 const matching=(release.assets||[]).filter(a=>a.name===name);
 if(matching.length!==1)throw Error('新版尚未提供唯一的 Windows x64 安装包');
 const a=matching[0];if(a.browser_download_url!==url||a.state!=='uploaded'||!/^sha256:[a-f0-9]{64}$/i.test(a.digest||'')||!Number.isSafeInteger(a.size)||a.size<2||a.size>MAX)throw Error('新版安装包地址、大小或 SHA256 元数据不完整');
 if(release.html_url!==page)throw Error('新版发布页地址不匹配');
 return {version:v,name,url,page,size:a.size,sha256:a.digest.slice(7).toLowerCase()};
}
async function fileHash(file){const h=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))h.update(chunk);return h.digest('hex');}
class Updater{
 constructor({currentVersion,dataDir,onChange=()=>{},platform=process.platform,arch=process.arch,transport}={}){
  this.currentVersion=currentVersion;this.dir=path.join(dataDir,'updates');this.onChange=onChange;this.supported=platform==='win32'&&arch==='x64';this.transport=transport||{getJSON,open};this.candidate=null;this.file=null;this.controller=null;
  this.state={status:'idle',version:null,progress:0,downloadedBytes:0,totalBytes:0,error:'',checkedAt:null,supported:this.supported,releasePage:PAGE};
 }
 snapshot(){return {...this.state};}
 set(s){Object.assign(this.state,s);this.onChange();}
 busy(){return ['checking','downloading'].includes(this.state.status);}
 async check(){
  if(this.busy())throw Error('更新操作正在进行');if(this.state.status==='ready')return this.snapshot();
  this.controller=new AbortController();const timer=setTimeout(()=>this.controller?.abort(),30000);
  this.candidate=null;this.file=null;this.set({status:'checking',error:'',progress:0,version:null,downloadedBytes:0,totalBytes:0,releasePage:PAGE});
  try{const data=await this.transport.getJSON(API,this.controller.signal);this.candidate=select(data,this.currentVersion);this.file=null;this.set({status:this.candidate?'available':'upToDate',version:this.candidate?.version||null,totalBytes:this.candidate?.size||0,downloadedBytes:0,checkedAt:Date.now(),releasePage:this.candidate?.page||PAGE});return this.snapshot();}
  catch(e){this.set({status:'error',error:String(e.message).slice(0,350)});throw e;}finally{clearTimeout(timer);this.controller=null;}
 }
 async verify(){
  if(!this.file||!this.candidate)throw Error('请先下载更新');const s=fs.lstatSync(this.file);
  if(!s.isFile()||s.isSymbolicLink()||s.nlink>1||s.size!==this.candidate.size||await fileHash(this.file)!==this.candidate.sha256)throw Error('安装包校验失败，请重新检查并下载');
  const fd=fs.openSync(this.file,'r'),header=Buffer.alloc(2);try{fs.readSync(fd,header,0,2,0);}finally{fs.closeSync(fd);}if(header.toString('ascii')!=='MZ')throw Error('缓存文件不是 Windows 可执行文件');
  return this.file;
 }
 async download(){
  if(!this.supported)throw Error('此版本仅支持 Windows x64 安装包更新');if(this.busy())throw Error('更新操作正在进行');if(!this.candidate)throw Error('请先检查更新');
  const candidate={...this.candidate};this.controller=new AbortController();const timer=setTimeout(()=>this.controller?.abort(),15*60*1000);let temp;
  this.set({status:'downloading',error:'',progress:0,downloadedBytes:0,totalBytes:candidate.size});
  try{
   fs.mkdirSync(this.dir,{recursive:true});this.file=path.join(this.dir,candidate.name);
   if(fs.existsSync(this.file)){try{await this.verify();this.set({status:'ready',progress:100,downloadedBytes:candidate.size});return this.snapshot();}catch{this.file=null;}}
   temp=path.join(this.dir,crypto.randomUUID()+'.part');const res=await this.transport.open(candidate.url,this.controller.signal);
   if(res.headers?.['content-length']&&Number(res.headers['content-length'])!==candidate.size){res.destroy();throw Error('安装包下载长度与发布信息不一致');}
   let received=0,last=0;const hash=crypto.createHash('sha256');
   const counter=new Transform({transform:(chunk,enc,done)=>{received+=chunk.length;if(received>candidate.size||received>MAX)return done(Error('安装包超过允许大小'));hash.update(chunk);if(Date.now()-last>150){last=Date.now();this.set({downloadedBytes:received,progress:Math.floor(received/candidate.size*100)});}done(null,chunk);}});
   await pipeline(res,counter,fs.createWriteStream(temp,{flags:'wx',mode:0o600}),{signal:this.controller.signal});
   if(received!==candidate.size||hash.digest('hex')!==candidate.sha256)throw Error('安装包 SHA256 校验失败，已拒绝使用');
   const fd=fs.openSync(temp,'r');const header=Buffer.alloc(2);try{fs.readSync(fd,header,0,2,0);}finally{fs.closeSync(fd);}if(header.toString('ascii')!=='MZ')throw Error('下载内容不是 Windows 可执行文件');
   this.file=path.join(this.dir,candidate.name);fs.renameSync(temp,this.file);temp=null;this.set({status:'ready',progress:100,downloadedBytes:received});return this.snapshot();
  }catch(e){this.file=null;this.set({status:'error',error:String(e.message).slice(0,350)});throw e;}finally{clearTimeout(timer);this.controller=null;if(temp)try{fs.unlinkSync(temp);}catch{}}
 }
 cancel(){this.controller?.abort();}
 async prepareInstall(){if(this.state.status!=='ready')throw Error('安装包尚未准备好');try{return await this.verify();}catch(e){this.file=null;this.set({status:'error',error:e.message});throw e;}}
}
module.exports={Updater,version,newer,safeURL,select,fileHash,API,PAGE};
