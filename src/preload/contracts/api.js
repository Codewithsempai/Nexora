/* NEXORA preload API contract and channel inventory. */
const VALID_IPC_CHANNELS = [
  'window:minimize', 'window:maximize', 'window:close', 'window:is-maximized', 'window:maximized-changed',
  'config:get', 'config:set', 'system:get-status', 'system:ping-sidecar', 'hotkey:update',
  'ai:key:save', 'ai:key:clear', 'ai:key:status', 'ai:models:list',
  'chat:generate', 'chat:stream', 'chat:stream:chunk', 'chat:model-switch', 'chat:cancel',
  'memory:list', 'memory:add', 'memory:delete', 'memory:clear', 'memory:search', 'memory:update', 'memory:stats', 'memory:changed',
  'reminder:list', 'reminder:add', 'reminder:quick', 'reminder:update', 'reminder:delete', 'reminder:done', 'reminder:snooze', 'reminder:speak', 'reminder:clear-done', 'reminder:changed', 'reminder:fired',
  'autonomy:state', 'autonomy:permission', 'autonomy:run-task', 'autonomy:stop', 'autonomy:log-clear', 'autonomy:explain-screen', 'autonomy:brief-now', 'autonomy:upkeep-now', 'autonomy:changed', 'autonomy:speak', 'autonomy:open-panel',
  'update:check', 'update:state', 'update:open', 'update:skip', 'update:available',
  'voice:wake:enable', 'voice:wake:disable', 'voice:live:start', 'voice:live:stop', 'voice:orb-profile', 'voice:pcm',
  'voice:status', 'voice:model-switch', 'voice:audio-output', 'voice:audio-stop', 'voice:caption', 'popup:init', 'popup:state', 'popup:profile', 'popup:open-main', 'popup:preview', 'popup:preview-stop',
];
module.exports = { VALID_IPC_CHANNELS };
