// Shell arguments and executable invocation are different in Windows PowerShell.
function argument(value,platform=process.platform){const text=String(value);return platform==='win32'?"'"+text.replace(/'/g,"''")+"'":"'"+text.replace(/'/g,"'\\''")+"'";}
function executable(value,platform=process.platform){return (platform==='win32'?'& ':'')+argument(value,platform);}
module.exports={argument,executable};
