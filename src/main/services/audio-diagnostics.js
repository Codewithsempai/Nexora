/* ==========================================================================
   NEXORA — Windows Audio Diagnostics (Read-Only)
   Inspects Windows Communications Audio Ducking preference without silently
   modifying system-wide Windows audio settings. Provides a safe, user-initiated
   action to open the Windows Sound -> Communications settings tab.
   ========================================================================== */
'use strict';

const { execFile } = require('child_process');

const DUCKING_LABELS = Object.freeze({
  0: 'Mute all other sounds',
  1: 'Reduce the volume of other sounds by 80% (Windows default)',
  2: 'Reduce the volume of other sounds by 50%',
  3: 'Do nothing',
});

function parseRegDwordOutput(stdout) {
  const match = /UserDuckingPreference\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(String(stdout || ''));
  if (!match) return null;
  const code = Number.parseInt(match[1], 16);
  return Number.isFinite(code) ? code : null;
}

function getWindowsAudioDiagnostics({ platform = process.platform, execFileImpl = execFile } = {}) {
  if (platform !== 'win32') {
    return Promise.resolve({
      platform,
      duckingCode: 3,
      duckingLabel: 'Not applicable on this OS',
      mayDuckOtherApps: false,
      guidance: '',
    });
  }

  return new Promise((resolve) => {
    execFileImpl(
      'reg',
      ['query', 'HKCU\\Software\\Microsoft\\Multimedia\\Audio', '/v', 'UserDuckingPreference'],
      { windowsHide: true, timeout: 3000 },
      (error, stdout) => {
        // When UserDuckingPreference is absent on Windows, Windows behaves as 1 (reduce by 80%).
        const parsed = error ? null : parseRegDwordOutput(stdout);
        const code = parsed === null ? 1 : parsed;
        const mayDuckOtherApps = code !== 3;
        resolve({
          platform,
          duckingCode: code,
          isDefaultUnset: parsed === null,
          duckingLabel: DUCKING_LABELS[code] || `Windows setting (${code})`,
          mayDuckOtherApps,
          guidance: mayDuckOtherApps
            ? 'Windows Sound -> Communications is set to adjust other app volumes during microphone/communications activity. Set it to "Do nothing" in Windows Sound -> Communications (and avoid Bluetooth Hands-Free headset mics when listening to stereo music).'
            : 'Windows Sound -> Communications is set to "Do nothing". Other applications keep their original volume.',
        });
      }
    );
  });
}

function openWindowsCommunicationsSettings({ platform = process.platform, execFileImpl = execFile } = {}) {
  if (platform !== 'win32') return { success: false, error: 'Supported on Windows only.' };
  try {
    execFileImpl('rundll32.exe', ['shell32.dll,Control_RunDLL', 'mmsys.cpl,,3'], { windowsHide: false }, () => {});
    return { success: true };
  } catch (error) {
    return { success: false, error: error?.message || 'Could not open Windows Sound settings.' };
  }
}

module.exports = {
  DUCKING_LABELS,
  parseRegDwordOutput,
  getWindowsAudioDiagnostics,
  openWindowsCommunicationsSettings,
};
