/* NEXORA Phase 2 foundation unit tests. */
const assert = require('assert');
const { ORB_STATES, STATE_CONFIGS, OrbStateManager } = require('../../src/renderer/orb/orb-state.js');
const { DEFAULT_CONFIG } = require('../../src/main/services/config.js');
const { VALID_IPC_CHANNELS } = require('../../src/preload/contracts/api.js');
const { buildContents, normalizeHistory, parseSseEvent, extractText, consumeSseResponse } = require('../../src/main/services/gemini-client.js');
const { MemoryStore } = require('../../src/main/services/memory-store.js');
const { extractMemories, extractForget, applyMemoryCommands } = require('../../src/main/services/memory-learner.js');
const { pcmRms, pcm16ToWav, isMuteCommand, isWakePhrase, matchWakePhrase, mergeTranscriptFragments, WakeClipDetector } = require('../../src/main/services/voice-utils.js');
const { ModelDirectory, classifyFailure, rankLiveModels, rankTextModels, TEXT_FALLBACK_MODELS, LIVE_FALLBACK_MODELS } = require('../../src/main/services/model-ladder.js');
const { parseReminder, formatDue } = require('../../src/main/services/reminder-parser.js');
const { ReminderService, nextOccurrence } = require('../../src/main/services/reminder-service.js');
const { applyAssistantCommands, applyAssistantCommandsSmart, commandNotice } = require('../../src/main/services/assistant-commands.js');
const { extractWithGemini, shouldExtract, parseReply } = require('../../src/main/services/memory-extractor.js');
const fs = require('fs');
const os = require('os');
const path = require('path');

function testPersistenceAcrossRestart() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-persist-'));
  const filePath = path.join(dir, 'memory-vault.enc');
  // 1. No OS secure storage at all: memory must still save and survive a "restart" (new instances).
  const noSafe = { isEncryptionAvailable: () => false };
  const first = new MemoryStore({ filePath, safeStorage: noSafe });
  const reminders = new ReminderService({ filePath: path.join(dir, 'reminders.json') });
  const out = applyAssistantCommands({ memoryStore: first, reminderService: reminders, text: 'Hey Nexora, I am Daya', source: 'chat' });
  assert.strictEqual(out.saved.length, 1);
  applyAssistantCommands({ memoryStore: first, reminderService: reminders, text: 'remind me to drink water in 20 minutes', source: 'voice' });
  const second = new MemoryStore({ filePath, safeStorage: noSafe });
  assert(second.buildContext('who am I').includes('Daya'));
  assert.strictEqual(new ReminderService({ filePath: path.join(dir, 'reminders.json') }).list().length, 1);
  // 2. An unreadable vault is backed up and replaced instead of blocking every save.
  fs.writeFileSync(filePath, Buffer.from('garbage-bytes'));
  const broken = new MemoryStore({ filePath, safeStorage: { isEncryptionAvailable: () => true, encryptString: (t) => Buffer.from(t), decryptString: () => { throw new Error('bad'); } } });
  assert.strictEqual(broken.add('preferences', 'The user likes tea', { source: 'chat' }).success, true);
  assert(fs.readdirSync(dir).some((f) => f.includes('unreadable')));
  // 2b. v0.3.6: OS secure storage flipping on/off between runs must NOT lose memory, and a bad file recovers from backup.
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-flip-')); const f2 = path.join(d2, 'memory-vault.enc');
  const secure = { isEncryptionAvailable: () => true, encryptString: (t) => Buffer.from('S' + t), decryptString: (b) => b.toString().slice(1) };
  new MemoryStore({ filePath: f2, safeStorage: secure }).add('personal', "The user's name is Daya", { key: 'name', source: 'chat' });
  new MemoryStore({ filePath: f2, safeStorage: noSafe }).add('preferences', 'The user likes tea', { source: 'voice' });
  const third = new MemoryStore({ filePath: f2, safeStorage: secure });
  assert.strictEqual(third.list('all').items.length, 2);
  fs.writeFileSync(f2, Buffer.from('truncated-garbage'));
  const rec = new MemoryStore({ filePath: f2, safeStorage: noSafe });
  assert.strictEqual(rec.list('all').items.length, 1, 'recovered from .bak');
  // 3. Names in the common spoken forms.
  for (const t of ["I'm Daya", 'my name is Daya', 'call me Daya', 'en peru Daya', 'Hi, this is Daya']) assert.strictEqual(extractMemories(t)[0]?.text, "The user's name is Daya", t);
  for (const t of ['I am tired', "I'm Hungry", 'I am from Chennai']) assert(!extractMemories(t).some((m) => m.key === 'name'), t);
  console.log('  persistence across restart ok');
}

async function testGeminiUnderstanding() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-smart-'));
  const store = new MemoryStore({ filePath: path.join(dir, 'm.enc'), safeStorage: { isEncryptionAvailable: () => false } });
  const reminders = new ReminderService({ filePath: path.join(dir, 'r.json') });
  const reply = (obj) => async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }) });
  // Tamil script message the regex cannot understand -> Gemini returns structured facts -> saved as personal info
  const tamil = 'என்னோட அப்பா பேரு ரவி, நான் SRM காலேஜ்ல படிக்கிறேன்';
  assert(shouldExtract(tamil));
  const fake = reply({ facts: [{ category: 'personal', key: 'rel:father', text: "The user's father is Ravi (ரவி)" }, { category: 'personal', key: 'edu:college', text: "The user's college is SRM" }, { category: 'knowledge', key: null, text: 'password is 1234' }], forget: [], reminder: null });
  const extractor = (a) => extractWithGemini({ ...a, fetchImpl: fake });
  const out = await applyAssistantCommandsSmart({ memoryStore: store, reminderService: reminders, text: tamil, source: 'chat', apiKey: 'k'.repeat(12), extractor });
  assert.strictEqual(out.saved.length, 2, 'sensitive text dropped');
  assert.strictEqual(store.list('personal').items.length, 2);
  // reminder understood by Gemini
  const due = new Date(Date.now() + 3600000); const pad = (n) => String(n).padStart(2, '0');
  const dueStr = `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}T${pad(due.getHours())}:${pad(due.getMinutes())}`;
  const out2 = await applyAssistantCommandsSmart({ memoryStore: store, reminderService: reminders, text: 'ஒரு மணி நேரத்துல தண்ணி குடிக்க ஞாபகப்படுத்து', apiKey: 'k'.repeat(12), extractor: (a) => extractWithGemini({ ...a, fetchImpl: reply({ facts: [], forget: [], reminder: { text: 'drink water', due: dueStr, repeat: 'none' } }) }) });
  assert.strictEqual(out2.reminders.length, 1);
  // no API key or API failure never breaks anything; plain questions are not sent
  const out3 = await applyAssistantCommandsSmart({ memoryStore: store, reminderService: reminders, text: 'என்னோட பேரு', apiKey: null });
  assert.strictEqual(out3.saved.length, 0);
  assert(!shouldExtract('what is the time now'));
  assert.strictEqual(parseReply('not json'), null);
  const bad = await extractWithGemini({ apiKey: 'k'.repeat(12), text: tamil, fetchImpl: async () => { throw new Error('offline'); } });
  assert.strictEqual(bad, null);
  console.log('  gemini understanding ok');
}

async function testTamilKeepsTamilAndClearing() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-tamil-'));
  const store = new MemoryStore({ filePath: path.join(dir, 'm.enc'), safeStorage: { isEncryptionAvailable: () => false } });
  // Memory is ALWAYS saved in English letters (v0.3.6), even when the user speaks Tamil
  const out = applyAssistantCommands({ memoryStore: store, text: 'என்னோட பெயர் டயா', source: 'chat' });
  assert.strictEqual(out.saved.length, 1);
  const item = store.list('personal').items[0];
  assert(/^The user's name is [A-Za-z]+$/.test(item.text), item.text); assert.strictEqual(item.value, 'Taya'); assert.strictEqual(item.key, 'name');
  // Gemini path also saves English (and any Tamil script that slips through is transliterated)
  const reply = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ facts: [{ category: 'personal', key: 'rel:father', value: 'Ravi', text: "The user's father is Ravi" }], forget: [], reminder: null }) }] } }] }) });
  const o2 = await applyAssistantCommandsSmart({ memoryStore: store, text: 'என் அப்பா பேரு ரவி', apiKey: 'k'.repeat(12), extractor: (a) => extractWithGemini({ ...a, fetchImpl: reply }) });
  assert.strictEqual(o2.saved[0], "The user's father is Ravi"); assert.strictEqual(store.list('personal').items.find((i) => i.key === 'rel:father').value, 'Ravi');
  // after clear nothing remains in the model context
  assert(store.buildContext('என் பெயர் என்ன').includes('Taya'));
  assert(store.clear('all').success); assert.strictEqual(store.buildContext('என் பெயர் என்ன'), '');
  console.log('  tamil memory + clear ok');
}

function testOrbStateManager() {
  const manager = new OrbStateManager(ORB_STATES.IDLE);
  assert.strictEqual(manager.getState(), ORB_STATES.IDLE);
  let notified = false;
  const unsubscribe = manager.subscribe(({ currentState }) => { if (currentState === ORB_STATES.LISTEN) notified = true; });
  assert.strictEqual(manager.setState(ORB_STATES.LISTEN), true);
  assert.strictEqual(manager.getState(), ORB_STATES.LISTEN);
  assert.strictEqual(notified, true);
  assert.strictEqual(manager.setState('invalid-state'), false);
  unsubscribe();
  assert(STATE_CONFIGS[ORB_STATES.ERROR]);
}

function testConfigDefaults() {
  assert.strictEqual(DEFAULT_CONFIG.version, '0.3.25');
  assert.strictEqual(DEFAULT_CONFIG.performance.mode, 'medium');
  assert.strictEqual(DEFAULT_CONFIG.appearance.theme, 'dark-amber');
  assert.strictEqual(DEFAULT_CONFIG.audio.enabled, true);
  assert.strictEqual(DEFAULT_CONFIG.application.closeToTray, true);
  assert.strictEqual(DEFAULT_CONFIG.ai.chatModel, 'gemini-2.5-flash');
  assert.strictEqual(DEFAULT_CONFIG.ai.liveModel, 'gemini-3.8-live');
}

function testIpcContracts() {
  assert(Array.isArray(VALID_IPC_CHANNELS));
  for (const channel of ['window:minimize', 'window:maximize', 'config:get', 'ai:key:save', 'chat:generate', 'chat:stream', 'chat:cancel', 'memory:list', 'memory:add', 'memory:delete', 'memory:clear', 'memory:search', 'ai:models:list', 'voice:model-switch', 'chat:model-switch']) {
    assert(VALID_IPC_CHANNELS.includes(channel), `Missing IPC contract: ${channel}`);
  }
  assert(VALID_IPC_CHANNELS.includes('voice:wake:enable'));
  assert(VALID_IPC_CHANNELS.includes('voice:live:start'));
  assert(VALID_IPC_CHANNELS.includes('voice:pcm'));
  assert(!VALID_IPC_CHANNELS.includes('chat:simulate-response'));
}

function testGeminiRequestHelpers() {
  const contents = buildContents('hello', [{ role: 'user', text: 'previous' }, { role: 'assistant', text: 'reply' }]);
  assert.deepStrictEqual(contents.map((item) => item.role), ['user', 'model', 'user']);
  assert.strictEqual(contents[2].parts[0].text, 'hello');
  assert.strictEqual(normalizeHistory('not-an-array').length, 0);
  assert.throws(() => buildContents('   ', []));
  const parsed = parseSseEvent('data: {"candidates":[{"content":{"parts":[{"text":"stream chunk"}]}}]}');
  assert.strictEqual(extractText(parsed), 'stream chunk');
}

function testEncryptedMemoryStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-memory-test-'));
  const filePath = path.join(dir, 'memory.enc');
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(value.split('').reverse().join('')), decryptString: (value) => Buffer.from(value).toString('utf8').split('').reverse().join('') };
  const store = new MemoryStore({ filePath, safeStorage });
  try {
    const saved = store.add('preferences', 'Prefers amber UI and concise answers');
    assert.strictEqual(saved.success, true);
    assert.strictEqual(store.list('preferences').items.length, 1);
    assert.strictEqual(store.search('amber UI').items.length, 1);
    assert.strictEqual(store.buildContext('concise answers').includes('concise answers'), true);
    assert.strictEqual(store.remove(saved.item.id).success, true);
    assert.strictEqual(store.list('all').items.length, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function testSmartMemory() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-memory2-'));
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: (v) => Buffer.from(v), decryptString: (v) => Buffer.from(v).toString('utf8') };
  const store = new MemoryStore({ filePath: path.join(dir, 'm.enc'), safeStorage });
  try {
    assert.deepStrictEqual(applyMemoryCommands(store, 'My name is Arun').saved, ["The user's name is Arun"]);
    applyMemoryCommands(store, 'call me Karthik');
    assert.strictEqual(store.list('personal').items.filter((i) => i.key === 'name').length, 1, 'name is replaced, not duplicated');
    assert(store.buildContext('who am i').includes('Karthik'), 'identity always in context');
    assert(applyMemoryCommands(store, 'Remember that my exam is on Friday').saved[0].includes("user's exam is on Friday"));
    assert(store.buildContext('when is my exam').includes('exam'));
    assert.strictEqual(applyMemoryCommands(store, 'I live in Madurai').saved.length, 1);
    assert.strictEqual(applyMemoryCommands(store, 'I like cricket and chess').saved.length, 1);
    assert.strictEqual(applyMemoryCommands(store, 'Do you remember my name?').saved.length, 0, 'questions are not saved');
    assert.strictEqual(applyMemoryCommands(store, 'my exam ninaivula vechuko').saved.length, 1, 'tanglish remember');
    assert.strictEqual(store.add('knowledge', 'Exam on Friday').duplicate, undefined);
    assert.strictEqual(store.add('knowledge', 'exam on friday.').duplicate, true, 'duplicates refreshed');
    assert.strictEqual(extractForget('forget it'), null);
    assert.deepStrictEqual(applyMemoryCommands(store, 'forget that I live in Madurai').forgotten.length, 1);
    assert(!store.buildContext('').includes('Madurai'));
    assert.strictEqual(extractMemories('what is the weather').length, 0);
    assert(store.search('தமிழ்').success);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

async function testVoiceWakeHelpers() {
  const voiced = Buffer.alloc(640);
  for (let i = 0; i < voiced.length / 2; i++) voiced.writeInt16LE(12000, i * 2);
  assert(pcmRms(voiced) > 0.03);
  const wav = pcm16ToWav(voiced);
  assert.strictEqual(wav.toString('ascii', 0, 4), 'RIFF');
  assert.strictEqual(wav.toString('ascii', 8, 12), 'WAVE');
  assert.strictEqual(isMuteCommand('mute'), true);
  assert.strictEqual(isMuteCommand('Nexora mute pannunga'), true);
  assert.strictEqual(isMuteCommand('please open settings'), false);
  assert.strictEqual(isMuteCommand('standby'), false);
  assert.strictEqual(isMuteCommand('mute volume'), false);
  assert.strictEqual(isMuteCommand('mute now please'), true);
  assert.strictEqual(isMuteCommand('okey mute pannungal'), true);
  assert.strictEqual(isWakePhrase('Hey Nexora'), true);
  assert.strictEqual(isWakePhrase('Nexora'), true);
  assert.strictEqual(isWakePhrase('Hey Nexo'), true);
  assert.strictEqual(isWakePhrase('Nexo'), true);
  assert.strictEqual(isWakePhrase('open the browser'), false);
  for (const yes of ['Hey Nexora', 'hey, Nexora!', 'Nexora', 'next ora', 'Hey next ora', 'hey nexora what time is it', 'Hey Nexo', 'nexo', 'nexorra', 'Hey Nexura', 'ஹே நெக்சோரா']) assert.strictEqual(matchWakePhrase(yes).matched, true, `should wake: ${yes}`);
  for (const no of ['', 'open the browser', 'what is the next thing to do', 'this is extra work', 'I need a nectar drink', 'the next one is for the team to decide later today please', 'Alexa play music', 'hello', 'Next round.', 'Nextora, play the track.', 'Kaiya pa.', 'Hello Nexora', 'okay nexora what time is it', 'nexora play the track']) assert.strictEqual(matchWakePhrase(no).matched, false, `should NOT wake: ${no}`);
  assert.strictEqual(mergeTranscriptFragments('Nexora mute', 'Nexora mute'), 'nexora mute');
  assert.strictEqual(mergeTranscriptFragments('nexora', 'mute'), 'nexora mute');

  let clipCount = 0;
  const detector = new WakeClipDetector((clip) => { clipCount++; assert(clip.length >= voiced.length * 10); });
  for (let i = 0; i < 10; i++) detector.feed(voiced);
  const silent = Buffer.alloc(640);
  for (let i = 0; i < 26; i++) detector.feed(silent); // 450 ms hang-over keeps "Hey … Nexora" in one clip
  assert.strictEqual(clipCount, 1);

  // "Hey ... Nexora" with a 300 ms pause is ONE clip, and a clip arriving while another is being transcribed is queued, not dropped.
  const clips = []; let release;
  const d2 = new WakeClipDetector((clip) => { clips.push(clip.length); return new Promise((resolve) => { release = resolve; }); });
  const burst = () => { for (let i = 0; i < 10; i++) d2.feed(voiced); };
  burst(); for (let i = 0; i < 15; i++) d2.feed(silent); burst(); for (let i = 0; i < 26; i++) d2.feed(silent);
  assert.strictEqual(clips.length, 1, 'pause inside the phrase must not split the clip');
  burst(); for (let i = 0; i < 26; i++) d2.feed(silent); // while the first clip is still being transcribed
  assert.strictEqual(clips.length, 1);
  release(); await new Promise((r) => setTimeout(r, 5));
  assert.strictEqual(clips.length, 2, 'queued clip is processed after the first finishes');
}

async function testGeminiStreamConsumer() {
  const payloads = [
    'data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"Hello \"}]}}]}\n\n',
    'data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"world\"}]}}]}\n\n',
  ];
  const encoded = payloads.map((part) => new TextEncoder().encode(part));
  const body = new ReadableStream({ start(controller) { encoded.forEach((chunk) => controller.enqueue(chunk)); controller.close(); } });
  const chunks = [];
  const result = await consumeSseResponse({ body }, (text) => chunks.push(text));
  assert.strictEqual(result, 'Hello world');
  assert.deepStrictEqual(chunks, ['Hello ', 'world']);
}


async function testModelSwitchLadders() {
  const fakeModels = [
    { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.5-flash-preview-tts', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.5-flash-image', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.8-live', supportedGenerationMethods: ['bidiGenerateContent'] },
    { name: 'models/gemini-2.5-flash-native-audio-preview-12-2025', supportedGenerationMethods: ['bidiGenerateContent'] },
    { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
  ];
  const directory = new ModelDirectory({
    now: () => 1000,
    fetchImpl: async () => ({ ok: true, json: async () => ({ models: fakeModels }) }),
  });
  const inventory = await directory.discover('test-key');
  assert.strictEqual(inventory.discovered, true);
  // TTS / image / embedding models never enter the chat ladder.
  assert.deepStrictEqual(inventory.textModels, ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.5-flash']);
  assert.deepStrictEqual(inventory.liveModels, ['gemini-3.8-live', 'gemini-2.5-flash-native-audio-preview-12-2025']);
  const textOrder = await directory.textOrder('test-key', 'gemini-2.5-flash');
  assert.strictEqual(textOrder[0], 'gemini-2.5-flash');
  assert(textOrder.length <= 4);
  const liveOrder = await directory.liveOrder('test-key', 'gemini-3.8-live');
  assert.strictEqual(liveOrder[0], 'gemini-3.8-live');
  assert.deepStrictEqual(await directory.liveOrder('test-key', 'gemini-3.8-live', { exclude: ['gemini-3.8-live'] }), ['gemini-2.5-flash-native-audio-preview-12-2025']);
  directory.markBad('gemini-2.5-flash', 'quota', 'high demand');
  assert.strictEqual((await directory.textOrder('test-key', 'gemini-2.5-flash'))[0], 'gemini-2.5-flash-lite');
  assert.strictEqual(classifyFailure(Object.assign(new Error('quota exceeded'), { status: 429 })), 'quota');
  assert.strictEqual(classifyFailure(Object.assign(new Error('model not found'), { status: 404 })), 'model');
  assert.strictEqual(classifyFailure(Object.assign(new Error('high demand'), { status: 503 })), 'server');
  assert.strictEqual(classifyFailure(Object.assign(new Error('socket lost'), { code: 'ECONNRESET' })), 'offline');
  assert.strictEqual(rankTextModels(TEXT_FALLBACK_MODELS)[0], 'gemini-2.5-flash');
  assert(rankLiveModels(LIVE_FALLBACK_MODELS)[0] === 'gemini-3.8-live');
  // Offline discovery falls back to the pinned ladders.
  const offline = new ModelDirectory({ fetchImpl: async () => { throw new Error('fetch failed'); } });
  assert.deepStrictEqual((await offline.textOrder('k', 'gemini-2.5-flash')).slice(0, 2), ['gemini-2.5-flash', 'gemini-2.5-flash-lite']);
  assert.strictEqual((await offline.liveOrder('k', 'gemini-3.8-live'))[0], 'gemini-3.8-live');
}

async function testSseErrorClassification() {
  const event = 'data: {"error":{"code":429,"message":"high demand; try another model"}}\n\n';
  const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(event)); controller.close(); } });
  await assert.rejects(() => consumeSseResponse({ body }, () => {}), /high demand/);
}


const NOW = new Date(2026, 10, 21, 11, 10, 0).getTime(); // Sat 21 Nov 2026 11:10 local
const hm = (ms) => { const d = new Date(ms); return `${d.getDate()}/${d.getMonth() + 1} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };

function testReminderParser() {
  let r = parseReminder('remind me to call mom in 10 minutes', NOW);
  assert(r.ok && r.text === 'call mom' && r.dueAt === NOW + 600000 && r.repeat === 'none');
  r = parseReminder('Remind me at 5pm to submit the report', NOW);
  assert(r.ok && r.text === 'submit the report' && hm(r.dueAt) === '21/11 17:00');
  r = parseReminder('remind me tomorrow at 9am to join the standup', NOW);
  assert(r.ok && r.text === 'join the standup' && hm(r.dueAt) === '22/11 9:00');
  r = parseReminder('remind me to drink water every day at 8am', NOW);
  assert(r.ok && r.repeat === 'daily' && hm(r.dueAt) === '22/11 8:00' && r.text === 'drink water');
  r = parseReminder('remind me in an hour and a half to check the oven', NOW);
  assert(r.ok && r.dueAt === NOW + 5400000 && r.text === 'check the oven');
  r = parseReminder('Hey Nexora, remind me on monday at 10 to pay rent', NOW);
  assert(r.ok && hm(r.dueAt) === '23/11 10:00' && r.text === 'pay rent');
  r = parseReminder('can you remind me to leave at 4:30 p.m. please', NOW);
  assert(r.ok && hm(r.dueAt) === '21/11 16:30' && r.text === 'leave');
  r = parseReminder('remind me at 3 to stretch', NOW);
  assert(r.ok && hm(r.dueAt) === '21/11 15:00'); // ambiguous "3" -> next occurrence
  r = parseReminder('wake me up at 6am', NOW);
  assert(r.ok && r.text === 'Wake up' && hm(r.dueAt) === '22/11 6:00');
  // Tanglish
  r = parseReminder('10 nimidam kalichi remind pannu tea podanum', NOW);
  assert(r.ok && r.dueAt === NOW + 600000 && /tea podanum/.test(r.text));
  r = parseReminder('naalaikku 7 mani ku remind pannu gym poganum', NOW);
  assert(r.ok && hm(r.dueAt) === '22/11 7:00' && r.text === 'gym poganum');
  // not reminders / need more info
  assert.strictEqual(parseReminder('what reminders do I have?', NOW), null);
  assert.strictEqual(parseReminder('my name is Daya', NOW), null);
  assert.strictEqual(parseReminder('remember to call mom', NOW), null); // memory, not a reminder
  r = parseReminder('remind me to call mom', NOW);
  assert(!r.ok && r.reason === 'no-time' && r.text === 'call mom');
  r = parseReminder('remind me today at 9am to stretch', NOW);
  assert(!r.ok && r.reason === 'past');
  assert.strictEqual(formatDue(NOW + 600000, NOW), 'in 10 minutes');
  assert(/^tomorrow at /.test(formatDue(new Date(2026, 10, 22, 9, 0).getTime(), NOW)));
}

function testReminderService() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-rem-'));
  const filePath = path.join(dir, 'reminders.json');
  let clock = NOW; const fired = []; const changes = [];
  const svc = new ReminderService({ filePath, now: () => clock, onFire: (item, info) => fired.push({ item, info }), onChange: (e) => changes.push(e.type) });
  assert(!svc.add({ text: '', dueAt: NOW + 1000 }).success);
  assert(!svc.add({ text: 'x', dueAt: NOW - 5 * 60000 }).success); // already passed
  const a = svc.add({ text: 'call mom', dueAt: NOW + 60000, source: 'voice' }); assert(a.success && a.item.status === 'pending' && a.item.source === 'voice');
  const b = svc.add({ text: 'daily water', dueAt: NOW + 120000, repeat: 'daily' }); assert(b.success);
  assert.strictEqual(svc.tick(NOW + 30000).length, 0);
  clock = NOW + 61000; assert.strictEqual(svc.tick().length, 1);
  assert.strictEqual(fired[0].item.text, 'call mom'); assert(!fired[0].info.late);
  assert.strictEqual(svc.list().find((i) => i.id === a.item.id).status, 'fired');
  assert.strictEqual(svc.tick().length, 0); // never fires twice
  // snooze moves it back to pending, done closes it
  assert(svc.snooze(a.item.id, 5).success); assert.strictEqual(svc.list().find((i) => i.id === a.item.id).status, 'pending');
  clock = NOW + 61000 + 6 * 60000; svc.tick(); assert(svc.done(a.item.id).success);
  assert.strictEqual(svc.list().find((i) => i.id === a.item.id).status, 'done');
  // repeating reminder fired and rescheduled to the same wall-clock time tomorrow
  const water = svc.list().find((i) => i.id === b.item.id); assert.strictEqual(water.status, 'pending'); assert(water.dueAt > clock);
  assert.strictEqual(new Date(water.dueAt).getHours(), new Date(NOW + 120000).getHours());
  // survives a restart, and an overdue reminder fires once as "late"
  const later = new Date(2026, 10, 22, 9, 0).getTime();
  const c = svc.add({ text: 'missed while closed', dueAt: clock + 60000 }); assert(c.success);
  const lateFired = []; const reopened = new ReminderService({ filePath, now: () => later, onFire: (item, info) => lateFired.push({ item, info }) });
  assert(reopened.list().some((i) => i.text === 'missed while closed'));
  reopened.tick(); assert(lateFired.some((f) => f.item.text === 'missed while closed' && f.info.late === true));
  assert(reopened.clearDone().success); assert(!reopened.list().some((i) => i.status === 'done'));
  assert(changes.includes('add') && changes.includes('fired') && changes.includes('snooze') && changes.includes('done'));
  // nextOccurrence rules
  const fri = new Date(2026, 10, 20, 9, 0).getTime(); // Friday
  assert.strictEqual(new Date(nextOccurrence(fri, 'weekdays', fri)).getDay(), 1); // -> Monday
  assert.strictEqual(new Date(nextOccurrence(fri, 'weekly', fri)).getDate(), 27);
  // a corrupt file never crashes startup
  fs.writeFileSync(filePath, '{not json'); assert.strictEqual(new ReminderService({ filePath }).list().length, 0);
}

function testAssistantCommandsAndLiveMemory() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-cmd-'));
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: (v) => Buffer.from(v), decryptString: (b) => Buffer.from(b).toString() };
  const store = new MemoryStore({ filePath: path.join(dir, 'm.enc'), safeStorage });
  const events = []; store.onChange = (e) => events.push(e);
  const reminders = new ReminderService({ filePath: path.join(dir, 'r.json'), now: () => NOW });
  // a reminder is a reminder, not a memory (even "don't forget …")
  let out = applyAssistantCommands({ memoryStore: store, reminderService: reminders, text: "don't forget to call mom at 5pm", source: 'voice', now: NOW });
  assert.strictEqual(out.reminders.length, 1); assert.strictEqual(store.list().items.length, 0);
  assert(/You just set a reminder/.test(commandNotice(out)));
  // memory saves are announced live with their source
  out = applyAssistantCommands({ memoryStore: store, reminderService: reminders, text: 'my name is Daya', source: 'voice', now: NOW });
  assert.strictEqual(out.saved.length, 1);
  assert(events.some((e) => e.type === 'add' && e.source === 'voice' && /Daya/.test(e.item.text)));
  assert.strictEqual(store.list().items[0].source, 'voice');
  // missing time / past time -> nothing saved and the assistant is told to ask
  out = applyAssistantCommands({ memoryStore: store, reminderService: reminders, text: 'remind me to buy milk', source: 'chat', now: NOW });
  assert.strictEqual(out.reminders.length, 0); assert(/gave no time/.test(commandNotice(out)));
  // edit / stats / forget / clear all notify
  const id = store.list().items[0].id;
  assert(store.update(id, { text: "The user's name is Daya S" }).success); assert(events.some((e) => e.type === 'update'));
  assert.strictEqual(store.stats().total, 1); assert.strictEqual(store.stats().byCategory.personal, 1);
  assert(!store.update(id, { category: 'nope' }).success);
  assert(store.remove(id).success); assert(events.some((e) => e.type === 'remove'));
  store.add('knowledge', 'one'); assert(store.clear('all').success); assert(events.some((e) => e.type === 'clear'));
}

function testPopupOrbDefaultsAndMigration() {
  assert.strictEqual(DEFAULT_CONFIG.appearance.popupOrbSize, 200);
  assert(DEFAULT_CONFIG.reminders.nativeNotifications === true);
  const { getConfigService } = require('../../src/main/services/config.js');
  const proto = Object.getPrototypeOf(getConfigService());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-cfg-'));
  const configPath = path.join(dir, 'nexora-config.json');
  fs.writeFileSync(configPath, JSON.stringify({ appearance: { popupOrbSize: 132 } }));
  const migrated = new proto.constructor({ configPath });
  assert.strictEqual(migrated.get('appearance.popupOrbSize'), 200); // old small size raised once
  migrated.set('appearance.popupOrbSize', 160); // the user's later choice is respected
  assert.strictEqual(new proto.constructor({ configPath }).get('appearance.popupOrbSize'), 160);
  for (const channel of ['memory:update', 'memory:stats', 'memory:changed', 'reminder:list', 'reminder:add', 'reminder:quick', 'reminder:done', 'reminder:snooze', 'reminder:fired', 'reminder:changed']) assert(VALID_IPC_CHANNELS.includes(channel), `Missing IPC contract: ${channel}`);
}

async function run() {
  testOrbStateManager();
  testConfigDefaults();
  testIpcContracts();
  testGeminiRequestHelpers();
  await testVoiceWakeHelpers();
  await testGeminiStreamConsumer();
  await testModelSwitchLadders();
  await testSseErrorClassification();
  testEncryptedMemoryStore();
  testPersistenceAcrossRestart();
  await testGeminiUnderstanding();
  await testTamilKeepsTamilAndClearing();
  testSmartMemory();
  testReminderParser();
  testReminderService();
  testAssistantCommandsAndLiveMemory();
  testPopupOrbDefaultsAndMigration();
  console.log('NEXORA core tests passed (memory, reminders, popup orb, config).');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
