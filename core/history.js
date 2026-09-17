const fs=require('fs'),path=require('path'),crypto=require('crypto'),rt=require('./runtime'),scope=require('./scope');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const dir=()=>path.join(rt.dataDir,'history');
const valid=id=>typeof id==='string'&&/^[a-f0-9-]+$/.test(id);
function sameRoot(a,b){if(!a||!b)return false;const normalize=p=>{try{p=fs.realpathSync(p);}catch{p=path.resolve(p);}return process.platform==='win32'?p.toLowerCase():p;};return normalize(a)===normalize(b);}
function get(id){if(!valid(id))return null;try{return JSON.parse(fs.readFileSync(path.join(dir(),id+'.json'),'utf8'));}catch{return null;}}
function names(){try{return fs.readdirSync(dir()).filter(n=>/^[a-f0-9-]+\.json$/.test(n));}catch{return [];}}
function list(){return names().map(n=>get(n.slice(0,-5))).filter(Boolean).sort((a,b)=>b.time-a.time);}
// Keep only small metadata in the UI cache, not complete before/after snapshots.
const cache=new Map();
function summaries(root){const live=new Set(),result=[];for(const n of names()){const file=path.join(dir(),n);live.add(file);try{const stat=fs.statSync(file),key=stat.mtimeMs+':'+stat.size;let entry=cache.get(file);if(!entry||entry.key!==key){const h=get(n.slice(0,-5));if(!h)continue;const {id,time,file:changedFile,root:workspace,restored,restoredAt,failed,unverified}=h;entry={key,data:{id,time,file:changedFile,root:workspace,restored,restoredAt,failed:!!failed,unverified:!!unverified,kind:h.before===null?'created':'modified'}};cache.set(file,entry);}if(sameRoot(entry.data.root,root))result.push({...entry.data});}catch{cache.delete(file);}}for(const key of cache.keys())if(!live.has(key))cache.delete(key);return result.sort((a,b)=>b.time-a.time);}
function record(file,before,after,write){
 fs.mkdirSync(dir(),{recursive:true});
 const h={id:crypto.randomUUID(),time:Date.now(),root:scope.primaryRoot(),file,before,after,afterHash:hash(after),afterBytes:Buffer.byteLength(after),restored:false};
 const location=path.join(dir(),h.id+'.json');
 // Persist the preimage before attempting a write. Only prune after success.
 fs.writeFileSync(location,JSON.stringify(h),{mode:0o600});
 try{if(write)write();}catch(error){
  try{
   if(fs.existsSync(file)&&fs.statSync(file).size>2*1024*1024)throw Error('Failed write result exceeds inspection limit');
   const actual=fs.existsSync(file)?fs.readFileSync(file):null;
   const previous=before===null?null:Buffer.from(before);
   if(actual===null&&previous===null||actual&&previous&&actual.equals(previous))fs.unlinkSync(location);
   else{
    h.failed=true;h.after=actual===null?'':actual.toString('utf8');h.afterHash=actual===null?null:hash(actual);h.afterBytes=actual?.length??0;
    fs.writeFileSync(location,JSON.stringify(h),{mode:0o600});
    error.message+='; partial write retained as revision '+h.id;
   }
  }catch(recoveryError){h.failed=true;h.unverified=true;try{fs.writeFileSync(location,JSON.stringify(h));}catch{}error.message+='; original snapshot retained, inspect revision '+h.id;}
  cache.delete(location);rt.changed();throw error;
 }
 for(const old of list().slice(50))fs.unlinkSync(path.join(dir(),old.id+'.json'));
 rt.changed();return h.id;
}
function restore(id){
 const h=get(id);if(!h||h.restored)throw Error('This revision cannot be restored');if(h.unverified)throw Error('Write result could not be verified. Inspect the saved preimage before manual recovery.');
 if(!sameRoot(scope.primaryRoot(),h.root))throw Error('Select the original workspace before restoring');
 const file=scope.resolvePath(h.file),conflict=()=>Error('File has changed since this revision. Restore refused to protect newer edits.');
 let current=null;
 if(fs.existsSync(file)){
  const stat=fs.statSync(file),expected=h.afterBytes??Buffer.byteLength(h.after);
  if(!stat.isFile()||stat.size>2*1024*1024||stat.size!==expected)throw conflict();
  current=fs.readFileSync(file);
 }
 if(h.afterHash===null?current!==null:current===null||hash(current)!==h.afterHash)throw conflict();
 if(h.before===null){if(current!==null)fs.unlinkSync(file);}else fs.writeFileSync(file,h.before);
 h.restored=true;h.restoredAt=Date.now();const location=path.join(dir(),h.id+'.json');fs.writeFileSync(location,JSON.stringify(h));cache.delete(location);rt.changed();return true;
}
module.exports={list,record,restore,hash,get,sameRoot,summaries};
