const fs=require('fs');const path=require('path');const rt=require('./runtime');const scope=require('./scope');const schemas=require('./schemas.json');const policy=require('./policy');
async function skills(){const {files}=await require('./walk').find('{.agents,.github,.codex,.gemini}/skills/*/SKILL.md','',100);return files.map(p=>({id:path.basename(path.dirname(p)),file:p}));}
const handlers={
 list_skills:async()=>{const s=await skills();return s.length?s.map(x=>`${x.id}: ${scope.displayPath(x.file)}`).join('\n'):'No workspace skills found';},
 read_skill:async a=>{const s=(await skills()).find(s=>s.id===a.skill_id);if(!s)throw Error('Unknown skill');const p=scope.resolvePath(path.resolve(path.dirname(s.file),a.resource_path||'SKILL.md'));if(!scope.inside(p,path.dirname(s.file)))throw Error('Resource must remain inside its skill folder');return require('./tools-files').read(p);},
 set_todos:async a=>{if(a.todos.length>100||a.todos.filter(t=>t.status==='in_progress').length>1)throw Error('At most 100 tasks and one in-progress task');rt.todos=a.todos;rt.changed();return 'Task list updated';},
 update_plan:async a=>handlers.set_todos({todos:a.plan.map((p,i)=>({id:'step-'+i,title:p.step,status:p.status}))}),
 report_progress:async a=>{rt.progress={message:a.message.slice(0,2000),phase:(a.phase||'').slice(0,100),percent:a.percent};rt.changed();return 'Progress updated';},
 screenshot:async a=>rt.capture(a),
 screenshot_window:async a=>{if(!a.window||a.window.length>200)throw Error('A window pattern of 1–200 characters is required');return rt.capture(a);},
 run_and_capture:async a=>{policy.ensureAllowed('run_and_capture');const approved=await rt.confirm({kind:'capture',message:`运行并截图\n${a.command}\n\n原因：${a.reason||'未提供'}\n可能包含屏幕上的敏感信息。`});if(!approved)throw Error('[user refused] Nothing was started');policy.ensureAllowed('run_and_capture');const exec=require('./tools-exec');const j=await exec.runGuarded({command:a.command,cwd:a.cwd,wait:false});try{await new Promise(r=>setTimeout(r,Math.min(15000,Math.max(0,a.wait_ms??4000))));const image=await rt.capture({...a,preConfirmed:true});const status=exec.renderRecord(j.record,false);if(!a.keep_running)await exec.stopCommand(j.id);return [{type:'text',text:status},...image];}catch(e){await exec.stopCommand(j.id);throw e;}}
};
module.exports={TOOLS:Object.entries(handlers).map(([name,run])=>({...schemas[name],run}))};
