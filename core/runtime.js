const os = require('os');
const path = require('path');
module.exports = {
  dataDir: path.join(os.tmpdir(), 'mcpgo-desktop-test'),
  config: {approvalMode:'manual', autoCheckUpdates:true, root:'', port:8788, permissions:{read:true,edit:false,execute:false,capture:false}, commandConfirm:true, screenshotConfirm:true, editConfirm:true, tunnelProvider:'none'},
  active: false,
  confirm: async () => false,
  capture: async () => { throw new Error('Screen capture is available only in the desktop application'); },
  changed: () => {}, activity: () => {}, todos: [], progress: null,
};
