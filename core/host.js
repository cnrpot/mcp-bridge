// Narrow desktop services used by the migrated .NET / Godot wrappers; not a VS Code emulation.
const rt=require('./runtime');
module.exports={workspace:{getConfiguration:()=>({get:(k,d)=>rt.config[k]??d}),findFiles:async(g,e,m)=> (await require('./walk').find(g,e,m)).files.map(fsPath=>({fsPath}))},window:{showWarningMessage:async(message,options,yes)=>await rt.confirm({kind:'confirm',message})?yes:undefined}};
