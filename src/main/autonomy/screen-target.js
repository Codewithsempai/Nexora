/* Owner: codewithsempai_daya — NEXORA */
/* NEXORA autonomy — pure helpers (unit-tested, no Electron):
 *  · parseScreenTarget  "chrome" / "brave screen" / "entire screen" / "this screen"  -> which monitor(s) to look at
 *  · WINDOW_SCRIPT + parseWindowLines + matchWindow   find an app's window (and so its monitor) on a multi-monitor PC
 *  · voiceDecision      "ok" / "allow" / "seri" / "no" / "venam"  -> allow | always | deny, ONLY for short answers */

const GENERIC = /^(?:all|any|every|everything|entire|whole|full|both|my|the|this|that|current|main|primary|first|second|other|screen|screens|window|windows|monitor|monitors|display|displays|desktop|pc|computer|laptop|your|our|one|an?|of|on|in|at|and|please|now|only|just|ellam|muzhu|muzhusa)$/i;
const CURSOR = /\b(?:this|current|active|here|cursor|mouse|focus(?:ed)?)\b/i;
const APP_WORDS = /\b(?:screen|window|windows|monitor|display|browser|app|application|tab|page)\b/gi;

/** text -> { kind: 'all' } | { kind: 'cursor' } | { kind: 'app', app: 'chrome' } */
function parseScreenTarget(text) {
  const raw = String(text || '').trim().toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s.+#-]/gu, ' ');
  if (!raw) return { kind: 'all' };
  const stripped = raw.replace(APP_WORDS, ' ').replace(/\s+/g, ' ').trim();
  const words = stripped.split(' ').filter(Boolean);
  const meaningful = words.filter((w) => !GENERIC.test(w) && !CURSOR.test(w));
  if (meaningful.length) return { kind: 'app', app: meaningful.join(' ').slice(0, 40) };
  if (/\b(?:all|every|entire|whole|full|both|everything|ellam)\b/.test(raw)) return { kind: 'all' };
  if (CURSOR.test(raw)) return { kind: 'cursor' };
  return { kind: 'all' };
}

/** PowerShell: every visible, non-minimised top-level window in Z-order (top first): proc|title|L|T|R|B|isForeground */
const WINDOW_SCRIPT = `Add-Type @"
using System; using System.Collections.Generic; using System.Runtime.InteropServices; using System.Text;
public class NxWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public static List<string> All() {
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch (Exception) { try { SetProcessDPIAware(); } catch (Exception) { } }   // real pixel coordinates on mixed-DPI monitors
    var list = new List<string>(); IntPtr fg = GetForegroundWindow();
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h) || IsIconic(h)) return true;
      int n = GetWindowTextLength(h); if (n == 0) return true;
      var sb = new StringBuilder(n + 1); GetWindowText(h, sb, n + 1);
      uint pid; GetWindowThreadProcessId(h, out pid); RECT r; GetWindowRect(h, out r);
      if (r.R - r.L < 120 || r.B - r.T < 80) return true;
      list.Add(pid + "\\t" + sb.ToString().Replace("\\t", " ") + "\\t" + r.L + "\\t" + r.T + "\\t" + r.R + "\\t" + r.B + "\\t" + (h == fg ? 1 : 0));
      return true;
    }, IntPtr.Zero);
    return list;
  }
}
"@
$names = @{}; Get-Process | ForEach-Object { $names[[string]$_.Id] = $_.ProcessName }
[NxWin]::All() | ForEach-Object { $p = $_.Split([char]9); $n = [string]$names[$p[0]]; $n + [string][char]9 + (($p[1..($p.Length - 1)]) -join [string][char]9) }`;

function parseWindowLines(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const p = line.split('\t'); if (p.length < 7) continue;
    const [proc, title, l, t, r, b, fg] = p; const rect = { l: Number(l), t: Number(t), r: Number(r), b: Number(b) };
    if (![rect.l, rect.t, rect.r, rect.b].every(Number.isFinite)) continue;
    out.push({ proc: String(proc || '').toLowerCase(), title, rect, fg: fg === '1' });
  }
  return out;
}

const PROC_ALIASES = { vscode: ['code'], edge: ['msedge'], calculator: ['calculatorapp', 'calc', 'applicationframehost'], terminal: ['windowsterminal', 'wt'], explorer: ['explorer'], powershell: ['powershell', 'windowsterminal'], paint: ['mspaint'], settings: ['systemsettings', 'applicationframehost'] };
const squash = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '');

/** Top-most window that belongs to `app` (process name or title contains the name). The foreground one wins when several match. */
function matchWindow(windows, app, builtinId = null) {
  const q = squash(app); if (!q) return null;
  const procs = new Set([q, ...(builtinId ? [builtinId, ...(PROC_ALIASES[builtinId] || [])] : [])]);
  const hits = (windows || []).filter((w) => {
    if (/^nexora/i.test(w.title) || w.proc === 'electron' && /nexora/i.test(w.title)) return false;          // never "see" NEXORA's own window
    const p = squash(w.proc); if (procs.has(p) || (q.length >= 4 && p.includes(q)) || (p.length >= 4 && q.includes(p))) return true;
    return q.length >= 3 && squash(w.title).includes(q);
  });
  return hits.find((w) => w.fg) || hits[0] || null;
}

const YES = new Set(['ok', 'okay', 'okk', 'okey', 'oke', 'k', 'yes', 'yeah', 'yep', 'yup', 'ya', 'yea', 'sure', 'allow', 'allowed', 'approve', 'approved', 'accept', 'proceed', 'continue', 'go', 'ahead', 'do', 'it', 'run', 'seri', 'sari', 'sariyaa', 'aama', 'aam', 'aamam', 'amam', 'correct', 'pannu', 'pannunga', 'panunga', 'sey', 'seyyunga', 'ஓகே', 'சரி', 'ஆமா', 'ஆம்', 'பண்ணு', 'பண்ணுங்க', 'அனுமதி', 'ओके', 'हाँ', 'हां', 'ठीक']);
const NO = new Set(['no', 'nope', 'nah', 'deny', 'denied', 'reject', 'refuse', 'dont', 'don', 'not', 'never', 'cancel', 'stop', 'venam', 'vendam', 'venaam', 'vendaam', 'illa', 'illai', 'ilaa', 'இல்லை', 'வேண்டாம்', 'வேணாம்', 'नहीं', 'नही', 'मत']);
const FILLER = new Set(['da', 'dei', 'di', 'bro', 'boss', 'sir', 'nexora', 'nexo', 'hey', 'please', 'pls', 'plz', 'the', 'that', 'this', 'for', 'session', 'sessions', 'only', 'once', 'one', 'time', 'now', 'just', 'thanks', 'thank', 'you', 'is', 'are', 'all', 'right', 'good', 'fine', 'great', 'a', 'to', 'of', 'task', 'step', 'steps', 'action', 'permission', 't', 'allow', 'always', 'eppavum', 'every', 'time', 'from', 'now', 'on', 'ellam', 'laam', 'la', 'ku', 'these', 'those', 'its', 'oh']);

/** "ok da" -> 'allow' · "always allow" -> 'always' · "no" / "venam" / "don't allow" -> 'deny' · anything else (incl. long sentences) -> null */
function voiceDecision(text) {
  const words = String(text || '').toLowerCase().replace(/['’]/g, '').replace(/[^\p{L}\p{M}\p{N}\s]+/gu, ' ').split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 7) return null;
  if (!words.every((w) => YES.has(w) || NO.has(w) || FILLER.has(w))) return null;
  if (words.some((w) => NO.has(w))) return 'deny';
  if (!words.some((w) => YES.has(w) && !['it', 'do', 'go', 'ahead', 'run'].includes(w)) && !(words.includes('go') && words.includes('ahead')) && !(words.includes('do') && words.includes('it')) && !words.includes('run')) return null;
  if (words.includes('always') || words.includes('eppavum') || (words.includes('every') && words.includes('time'))) return 'always';
  return 'allow';
}
module.exports = { parseScreenTarget, WINDOW_SCRIPT, parseWindowLines, matchWindow, voiceDecision };
