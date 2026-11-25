/*
 * NEXORA Gemini REST client helpers.
 * Keeps request shaping and SSE parsing independent from Electron for unit tests.
 */
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const MAX_HISTORY_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 8000;

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((message) => message && ['user', 'assistant', 'model'].includes(message.role) && typeof message.text === 'string')
    .slice(-MAX_HISTORY_MESSAGES)
    .map((message) => ({
      role: message.role === 'assistant' || message.role === 'model' ? 'model' : 'user',
      parts: [{ text: message.text.slice(0, MAX_MESSAGE_CHARS) }],
    }));
}

function buildContents(prompt, history) {
  const cleanPrompt = typeof prompt === 'string' ? prompt.trim() : '';
  if (!cleanPrompt || cleanPrompt.length > 20000) throw new Error('Message is empty or exceeds the 20,000 character limit.');
  return [...normalizeHistory(history), { role: 'user', parts: [{ text: cleanPrompt }] }];
}

function extractText(payload) {
  return payload?.candidates?.[0]?.content?.parts?.map((part) => typeof part.text === 'string' ? part.text : '').join('') || '';
}

class GeminiApiError extends Error {
  constructor(message, status = 0, payload = null) { super(message); this.name = 'GeminiApiError'; this.status = Number(status) || 0; this.payload = payload; }
}

function parseSseEvent(eventText) {
  const data = eventText.split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('\n');
  if (!data || data === '[DONE]') return null;
  try { return JSON.parse(data); } catch { return null; }
}

async function consumeSseResponse(response, onText, signal) {
  if (!response.body?.getReader) {
    const payload = await response.json();
    const text = extractText(payload);
    if (text) onText(text);
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let aggregate = '';
  const dispatch = (block) => {
    const payload = parseSseEvent(block);
    if (payload?.error) throw new GeminiApiError(payload.error.message || 'Gemini returned an SSE error.', payload.error.code || payload.error.status || 0, payload);
    const text = extractText(payload);
    if (text) { aggregate += text; onText(text); }
  };
  try {
    while (true) {
      if (signal?.aborted) throw new Error('Request cancelled.');
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() || '';
      for (const event of events) dispatch(event);
    }
    buffer += decoder.decode();
    if (buffer.trim()) dispatch(buffer);
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  return aggregate;
}

module.exports = { DEFAULT_GEMINI_MODEL, GeminiApiError, normalizeHistory, buildContents, extractText, parseSseEvent, consumeSseResponse };
