const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { MemoryStore } = require('../../src/main/services/memory-store.js');
const { extractWithGemini } = require('../../src/main/services/memory-extractor.js');
const { applyAssistantCommandsSmart, applyAssistantCommands } = require('../../src/main/services/assistant-commands.js');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-cat-'));
  const store = new MemoryStore({ filePath: path.join(dir, 'm.enc'), safeStorage: { isEncryptionAvailable: () => false } });
  // quick rules: project / preference / knowledge land in the right folders
  applyAssistantCommands({ memoryStore: store, text: 'my project is NEXORA', source: 'chat' });
  applyAssistantCommands({ memoryStore: store, text: 'I like filter coffee', source: 'chat' });
  applyAssistantCommands({ memoryStore: store, text: 'remember that my exam is on 5 December', source: 'chat' });
  // a rich message: quick rules catch the name, Gemini sorts the rest (projects + preferences + knowledge)
  const reply = { facts: [
    { category: 'personal', key: 'name', value: 'Daya', text: "The user's name is Daya" },
    { category: 'projects', text: 'The user is building a desktop AI assistant called NEXORA' },
    { category: 'preferences', text: 'The user prefers short answers' },
    { category: 'knowledge', text: 'The user uses Electron and Rust' },
    { category: 'conversations', text: 'The user decided to use Gemini Live for memory' }], forget: [], reminder: null };
  const fake = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] }) });
  const out = await applyAssistantCommandsSmart({ memoryStore: store, text: "I am Daya and I'm building NEXORA, I prefer short answers", source: 'chat', apiKey: 'k'.repeat(12), extractor: (a) => extractWithGemini({ ...a, fetchImpl: fake }) });
  assert(out.saved.length >= 4, 'Gemini facts merged: ' + out.saved.length);
  const by = (c) => store.list(c).items.length;
  assert(by('projects') >= 1 && by('preferences') >= 1 && by('knowledge') >= 1 && by('conversations') >= 1 && by('personal') >= 1, 'every folder filled');
  assert(store.buildContext('what am I building').includes('NEXORA'));
  console.log('  memory folders (personal / preferences / knowledge / projects / conversations) ok');
})().catch((e) => { console.error(e); process.exit(1); });
