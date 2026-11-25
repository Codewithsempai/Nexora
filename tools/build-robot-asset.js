// Re-generates src/renderer/robot/robot-fbx.js (the robot model as base64) from assets/robot/Nexora_Robot.fbx.
// The renderer CSP is script-src 'self', and file:// fetch is not reliable in Electron, so the model ships as a script.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const b64 = fs.readFileSync(path.join(root, 'assets/robot/Nexora_Robot.fbx')).toString('base64');
fs.writeFileSync(path.join(root, 'src/renderer/robot/robot-fbx.js'), 'window.NEXORA_ROBOT_FBX_B64="' + b64 + '";\n');
console.log('robot-fbx.js written', (b64.length / 1e6).toFixed(1) + ' MB');
