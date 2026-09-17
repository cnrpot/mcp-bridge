const fs = require('fs');
const path = require('path');
const rt = require('./runtime');
function inside(p,root){const r=path.relative(root,p);return r===''||(!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r));}
function roots(){return rt.config.root ? [fs.realpathSync(rt.config.root)] : [];}
function primaryRoot(){return roots()[0]||null;}
function resolvePath(input){
 if(typeof input!=='string'||!input||input.includes('\0'))throw Error('A valid workspace path is required');
 const root=primaryRoot();if(!root)throw Error('Choose a workspace folder in mcp-bridge first');
 if(process.platform==='win32' && input.replace(/^[a-z]:/i,'').includes(':'))throw Error('Alternate data streams and device paths are not allowed');
 const candidate=path.resolve(root,input);
 if(!inside(candidate,root))throw Error('Path is outside the selected workspace');
 let existing=candidate;
 while(!fs.existsSync(existing)){
  try { if(fs.lstatSync(existing).isSymbolicLink())throw Error('Broken symbolic link is not allowed'); }catch(e){if(e.code!=='ENOENT')throw e;}
  const parent=path.dirname(existing);if(parent===existing)throw Error('Cannot resolve path');existing=parent;
 }
 const real=fs.realpathSync(existing);
 if(!inside(real,root))throw Error('Symbolic link / junction escapes the selected workspace');
 if(fs.statSync(existing).isFile() && fs.statSync(existing).nlink>1)throw Error('Hard-linked files are not supported by workspace tools');
 return candidate;
}
function inScope(p){try{resolvePath(p);return true;}catch{return false;}}
function displayPath(p){const root=primaryRoot();return root&&inside(p,root)?path.relative(root,p)||'.':p;}
module.exports={roots,primaryRoot,resolvePath,inScope,displayPath,inside};
