const fs=require('fs');const path=require('path');const {minimatch}=require('minimatch');const scope=require('./scope');
const ignored=new Set(['node_modules','.git','dist','build','release','.godot','.next','.cache']);
async function find(glob='**/*',exclude='',max=200){
 if(typeof glob!=='string'||glob.length>256||exclude.length>256)throw Error('Glob is too long');
 const root=scope.primaryRoot();if(!root)throw Error('Choose a workspace first');
 const found=[];let scanned=0;const queue=[root];let limited=false;
 while(queue.length&&found.length<max){const dir=queue.pop();let entries;try{entries=await fs.promises.readdir(scope.resolvePath(dir),{withFileTypes:true});}catch{continue;}
  for(const e of entries){if(++scanned>20000){limited=true;queue.length=0;break;}if(e.isSymbolicLink())continue;
   const p=path.join(dir,e.name);const rel=path.relative(root,p).split(path.sep).join('/');
   if(e.isDirectory()){if(!ignored.has(e.name)&&(!exclude||!minimatch(rel+'/',exclude,{dot:true})&&!minimatch(rel+'/x',exclude,{dot:true})))queue.push(p);}
   else if(e.isFile()&&minimatch(rel,glob,{dot:true})&&(!exclude||!minimatch(rel,exclude,{dot:true}))&&scope.inScope(p)){found.push(p);if(found.length>=max){limited=true;break;}}
  }
 }
 return {files:found,limited};
}
module.exports={find};
