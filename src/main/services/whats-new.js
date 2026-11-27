/* NEXORA — "What's new" text for the popup shown after an update.
 * Reads the matching sections out of CHANGELOG.md (shipped inside the app). No network, never throws. */
const fs = require('fs');
const { parseVersion, compareVersions } = require('./update-checker');

const MAX_SECTIONS = 3;       // upgrading across many versions: show the newest few
const MAX_CHARS = 6000;

/** CHANGELOG text -> [{ version, title, date, body }] newest first, as written in the file. */
function parseChangelog(text) {
  const sections = [];
  const parts = String(text || '').replace(/\r\n/g, '\n').split(/^##\s+/m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const heading = (nl === -1 ? part : part.slice(0, nl)).trim();
    const m = /^v?(\d+\.\d+\.\d+)\s*(?:[—–-]\s*(.*))?$/.exec(heading);
    if (!m) continue;
    const date = /\((\d{4}-\d{2}-\d{2})\)\s*$/.exec(m[2] || '')?.[1] || null;
    const title = String(m[2] || '').replace(/\s*\(\d{4}-\d{2}-\d{2}\)\s*$/, '').trim();
    sections.push({ version: m[1], title, date, body: (nl === -1 ? '' : part.slice(nl + 1)).trim() });
  }
  return sections;
}

/** Sections newer than `lastSeen` (or just the current one when nothing was seen) and not newer than `current`. */
function pickSections(sections, current, lastSeen) {
  const upTo = sections.filter((s) => compareVersions(s.version, current) <= 0);
  const fresh = parseVersion(lastSeen) ? upTo.filter((s) => compareVersions(s.version, lastSeen) > 0) : upTo.slice(0, 1);
  return fresh.slice(0, MAX_SECTIONS);
}

/**
 * @returns {{ show:boolean, version:string, sections:Array, text:string }}
 * show is true when the app now runs a version the user has not been told about yet, after setup is done.
 */
function getWhatsNew({ configService, currentVersion, changelogPath, readFile = (p) => fs.readFileSync(p, 'utf8') } = {}) {
  const none = { show: false, version: currentVersion, sections: [], text: '' };
  try {
    if (!parseVersion(currentVersion)) return none;
    const lastSeen = String(configService?.get?.('updates.lastSeenVersion') || '');
    if (lastSeen === currentVersion) return none;
    // First run of a brand-new install: nothing to explain yet. Remember the version so the NEXT update shows notes.
    if (configService?.get?.('setup.completed') !== true) {
      if (!lastSeen) configService?.set?.('updates.lastSeenVersion', currentVersion);
      return none;
    }
    const sections = pickSections(parseChangelog(readFile(changelogPath)), currentVersion, lastSeen);
    if (!sections.length) { configService?.set?.('updates.lastSeenVersion', currentVersion); return none; }
    const text = sections.map((s) => `## ${s.version}${s.title ? ` — ${s.title}` : ''}\n${s.body}`).join('\n\n').slice(0, MAX_CHARS);
    return { show: true, version: currentVersion, sections: sections.map((s) => ({ version: s.version, title: s.title, date: s.date })), text };
  } catch { return none; }
}

function markWhatsNewSeen({ configService, currentVersion } = {}) {
  if (!parseVersion(currentVersion)) return false;
  return !!configService?.set?.('updates.lastSeenVersion', currentVersion);
}

module.exports = { parseChangelog, pickSections, getWhatsNew, markWhatsNewSeen };
