const rt=require('./runtime');
const read=new Set(['read_files','read_image','list_directory','find_files','search_files','list_skills','read_skill','get_command_output','list_jobs']);
const neutral=new Set(['cancel_command','set_todos','update_plan','report_progress']);
function capability(name){if(neutral.has(name))return null;if(read.has(name))return 'read';if(name==='apply_patch')return 'edit';if(name==='screenshot'||name==='screenshot_window')return 'capture';return 'execute';}
function ensureAllowed(name){const c=capability(name);if(c&&!rt.config.permissions[c])throw Error(`[permission denied] Enable ${c} in mcp-bridge. Stop; do not retry through another tool.`);if(name==='run_and_capture'&&!rt.config.permissions.capture)throw Error('[permission denied] Enable capture in mcp-bridge.');}
module.exports={capability,ensureAllowed};
