const rt=require('./runtime');
const modes=['manual','auto','full'];
const defaults=()=>({read:true,edit:false,execute:false,capture:false});
function mode(){return modes.includes(rt.config.approvalMode)?rt.config.approvalMode:'manual';}
function normalize(config){
 if(!modes.includes(config.approvalMode)||config.approvalMode==='full'&&config.fullAccessAcknowledged!==true)config.approvalMode='manual';
 if(config.approvalMode==='full')config.permissions={read:true,edit:true,execute:true,capture:true};
 config.editConfirm=config.approvalMode==='manual';config.commandConfirm=config.approvalMode==='manual';config.screenshotConfirm=config.approvalMode!=='full';
 if(typeof config.autoCheckUpdates!=='boolean')config.autoCheckUpdates=true;
 return config;
}
function apply(next){
 if(!modes.includes(next))throw Error('未知审批模式');
 const previous=mode(),c=rt.config;
 if(next==='full'&&previous!=='full'){c.modePreviousPermissions={...c.permissions};c.fullAccessAcknowledged=true;}
 if(previous==='full'&&next!=='full'){c.permissions={...defaults(),...c.modePreviousPermissions};delete c.modePreviousPermissions;c.fullAccessAcknowledged=false;}
 c.approvalMode=next;normalize(c);rt.epoch=(rt.epoch||0)+1;rt.changed();
}
const needs=kind=>kind==='edit'?mode()==='manual':kind==='capture'?mode()!=='full':mode()==='manual';
const commandRisks=text=>mode()==='full'?[]:mode()==='manual'?['命令逐次审批（具有当前 Windows 用户权限）']:require('./guard').scan(text);
module.exports={mode,normalize,apply,needs,commandRisks,modes};
