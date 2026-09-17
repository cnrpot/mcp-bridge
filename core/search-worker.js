const {parentPort,workerData}=require('worker_threads');const fs=require('fs');const rt=require('./runtime');rt.config.root=workerData.root;
(async()=>{const a=workerData.args;const pattern=a.is_regex?new RegExp(a.query,a.is_case_sensitive?'':'i'):null;
 const found=await require('./walk').find(a.include||'**/*','',3000);let results=[];let skipped=0;
 for(const p of found.files){let st=fs.statSync(p);if(st.size>524288){skipped++;continue;}const text=fs.readFileSync(p,'utf8');if(text.includes('\0'))continue;
 const lines=text.split(/\r?\n/);for(let i=0;i<lines.length;i++){const line=lines[i];const ok=pattern?pattern.test(line):(a.is_case_sensitive?line.includes(a.query):line.toLowerCase().includes(a.query.toLowerCase()));if(ok)results.push(`${require('./scope').displayPath(p)}:${i+1}: ${line.slice(0,1200)}`);if(results.length>=a.max_results)break;}if(results.length>=a.max_results)break;}
 parentPort.postMessage(`${results.length} matches${found.limited?' (file scan limit reached)':''}; ${skipped} oversized files skipped\n${results.join('\n')}`);
})().catch(e=>parentPort.postMessage({error:e.message}));
