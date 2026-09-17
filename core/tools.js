const Ajv=require('ajv');const rt=require('./runtime');const policy=require('./policy');
const TOOLS=[...require('./tools-files').TOOLS,...require('./tools-extra').TOOLS,...require('./tools-exec').TOOLS,...require('./tools-dotnet').TOOLS,...require('./tools-godot').TOOLS];
const ajv=new Ajv({strict:false,allErrors:false});const map=new Map(TOOLS.map(t=>[t.name,{...t,validate:ajv.compile(t.inputSchema)}]));
const priority=new Set(['get_command_output','cancel_command','send_command_input','list_jobs','set_todos','update_plan','report_progress']);let active=0;let mutation=Promise.resolve();
async function call(name,args={}){const t=map.get(name);if(!t)throw Error('Unknown or unsupported tool: '+name);policy.ensureAllowed(name);if(!t.validate(args))throw Error('Invalid arguments: '+ajv.errorsText(t.validate.errors));
 const counted=!priority.has(name);if(counted&&active>=12)throw Error('Server is busy; retry after existing calls finish');if(counted)active++;
 const time=Date.now();try{let result;if(name==='apply_patch'){const work=mutation.then(()=>{policy.ensureAllowed(name);return t.run(args);});mutation=work.catch(()=>{});result=await work;}else result=await t.run(args);
 if(name==='cancel_command'&&!rt.config.permissions.read)result='Command stopped. Output hidden because Read permission is off.';
 rt.activity({name,ok:true,ms:Date.now()-time});return {content:Array.isArray(result)?result:[{type:'text',text:String(result)}]};
 }catch(e){rt.activity({name,ok:false,ms:Date.now()-time});throw e;}finally{if(counted)active--;}}
const list=()=>TOOLS.map(({name,title,description,inputSchema})=>({name,title,description,inputSchema}));
module.exports={list,call,busy:()=>active};
