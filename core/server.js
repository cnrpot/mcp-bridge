const http=require('http');const crypto=require('crypto');const rt=require('./runtime');const tools=require('./tools');
const supported=['2025-06-18','2025-03-26','2024-11-05'];
function instructions(){return `You are connected to mcp-bridge, a Windows MCP application.
Filesystem tools are restricted to this selected workspace: ${rt.config.root}
Permissions: ${Object.entries(rt.config.permissions).map(([k,v])=>k+': '+(v?'ON':'OFF')).join(', ')}.
IMPORTANT: Execute is NOT an OS sandbox. Commands start in the workspace but run with the desktop user's full system privileges. Respect the user's intended scope; never use execution to bypass a denied filesystem permission.
Read files before edits. apply_patch uses exact matches and writes to disk. Changes are reviewed and restored in the application's Change history. Never overwrite unsaved work in another editor.
If a permission or confirmation is denied, stop and explain which desktop control is required. Do not retry via another tool.
Check list_skills first. Use wait=false for long commands and poll get_command_output; cancel_command stops the process tree. Report honest results from actual builds/tests.
Use set_todos OR update_plan, at most one item in_progress. report_progress updates the desktop dashboard.
Screenshots require separate Capture permission and normally local confirmation. They may contain sensitive screen content.
Only tools returned by tools/list are supported. .NET and Godot tools require separately installed toolchains. Search skips symlinks and dependency/build directories and has bounded budgets.
Never put credentials in commands or progress messages. Logs and recent change snapshots are retained locally.
${rt.config.extraInstructions||''}`;}
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
class Bridge{
 constructor(){this.server=null;this.token='';this.publicHost='';this.port=0;}
 async start(port,token){if(this.server)throw Error('Bridge already running');if(!rt.config.root)throw Error('Choose a workspace first');require('./scope').primaryRoot();this.token=token;this.port=port;
  const server=http.createServer((req,res)=>this.handle(req,res));this.server=server;server.requestTimeout=90000;server.headersTimeout=15000;server.keepAliveTimeout=5000;
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});this.port=server.address().port;rt.active=true;rt.changed();}catch(e){this.server=null;throw e;}
 }
 async stop(){rt.active=false;const s=this.server;this.server=null;this.publicHost='';if(s){s.closeAllConnections();await new Promise(r=>s.close(r));}rt.changed();}
 url(){return this.server?`http://127.0.0.1:${this.port}/mcp/${this.token}`:'';}
 auth(token){const a=Buffer.from(token||'');const b=Buffer.from(this.token);return a.length===b.length&&crypto.timingSafeEqual(a,b);}
 async handle(req,res){const send=(code,body)=>{if(res.destroyed||res.writableEnded)return;res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(body===undefined?'':JSON.stringify(body));};
  const host=req.headers.host||'';const allowed=[`127.0.0.1:${this.port}`,`localhost:${this.port}`,this.publicHost].filter(Boolean);if(!allowed.includes(host))return send(403,{error:'Host rejected'});
  if(req.headers.origin&&!['http://127.0.0.1:'+this.port,'http://localhost:'+this.port].includes(req.headers.origin))return send(403,{error:'Origin rejected'});
  const url=new URL(req.url,'http://localhost');if(url.pathname==='/health'&&req.method==='GET')return send(200,{status:'ok'});
  const parts=url.pathname.split('/');if(parts.length!==3||!['mcp','guide'].includes(parts[1])||!this.auth(parts[2]))return send(404,{error:'Not found'});
  if(parts[1]==='guide'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'",'Cache-Control':'no-store'});return res.end(`<html lang="zh-CN"><meta charset="utf-8"><title>mcp-bridge · 连接指南</title><style>body{font:16px/1.7 system-ui;max-width:880px;margin:60px auto;padding:24px;color:#152d40;background:#f6f9fb}pre{white-space:pre-wrap;background:white;padding:24px;border-radius:16px}h1{color:#097b68}</style><h1>mcp-bridge</h1><p>所有 JSON-RPC 请求使用 POST。完整连接地址中的 token 等同访问凭据，请勿公开分享。</p><pre>${escape(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'my-client',version:'1.0'}}},null,2))}</pre><p>随后发送 notifications/initialized 通知，再调用 tools/list。</p><pre>${escape(instructions())}</pre></html>`);}
  if(req.method!=='POST'){res.setHeader('Allow','POST');return send(405,{error:'Use POST JSON-RPC'});}
  if(!(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))return send(415,{error:'application/json required'});
  let size=0;const chunks=[];let oversized=false;req.on('data',c=>{size+=c.length;if(size>2*1024*1024){oversized=true;chunks.length=0;send(413,{error:'Request exceeds 2 MiB'});}else if(!oversized)chunks.push(c);});req.on('error',()=>{});
  req.on('end',async()=>{if(oversized)return;let m;try{m=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return send(400,{jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}});}
   if(!m||Array.isArray(m)||m.jsonrpc!=='2.0'||typeof m.method!=='string'||(m.id!==undefined&&m.id!==null&&!['string','number'].includes(typeof m.id)))return send(400,{jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid request'}});
   if(m.id===undefined){if(m.method==='notifications/initialized'||m.method==='notifications/cancelled')return send(202);return send(400,{error:'Unsupported notification'});}
   const reply=result=>send(200,{jsonrpc:'2.0',id:m.id,result});
   try{if(!rt.active)throw Error('Bridge stopped');switch(m.method){
    case 'initialize':return reply({protocolVersion:supported.includes(m.params?.protocolVersion)?m.params.protocolVersion:supported[0],capabilities:{tools:{listChanged:false}},serverInfo:{name:'mcp-bridge',version:require('../package.json').version},instructions:instructions()});
    case 'ping':return reply({});case 'tools/list':return reply({tools:tools.list()});
    case 'tools/call':try{return reply(await tools.call(m.params?.name,m.params?.arguments??{}));}catch(e){return reply({isError:true,content:[{type:'text',text:e.message}]});}
    default:return send(200,{jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'Method not found'}});
   }}catch(e){send(200,{jsonrpc:'2.0',id:m.id,error:{code:-32603,message:e.message}});}
  });
 }
}
module.exports={Bridge,instructions};
