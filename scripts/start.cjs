// Some parent processes may inherit Electron's Node-only mode.
const {spawn}=require('child_process');const path=require('path');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(process.execPath,[path.join(__dirname,'..','node_modules','electron','cli.js'),'.',...process.argv.slice(2)],{cwd:path.join(__dirname,'..'),env,stdio:'inherit'});
child.on('error',e=>{console.error(e.message);process.exitCode=1;});child.on('exit',code=>{process.exitCode=code??1;});
