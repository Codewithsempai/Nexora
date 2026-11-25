/* ========================================================================
 * NEXORA — one-shot Gemini Live transcription (used for the WAKE word).
 *
 * Ported from the JARVIS MARK 34 reference (core/gemini.py): the Live API draws on a
 * DIFFERENT quota pool from the text (generateContent) models. On the free tier the text
 * pool is the one that runs out, and when it does wake-word checks fail silently and
 * NEXORA looks "deaf". So the wake clip is transcribed by a short, throwaway Live session
 * first, and the text models only act as the fallback.
 *
 * The session never speaks to the user: its audio output is thrown away, nothing from it
 * reaches the speaker, and it is closed the moment the transcript is known.
 * ======================================================================== */
const { mergeTranscriptFragments, boostPcm } = require('./voice-utils');

const SILENT_TRANSCRIBER = 'You are a silent microphone transcriber, not an assistant. The speaker uses English, Tamil or Tanglish (Indian accent), never Hindi: always write the words in Latin letters (English alphabet), and write the assistant name as "Nexora" or "Nexo" when you hear it, preceded by "Hey" if said. Never answer, never greet, never ask anything. If you must produce any output at all, output a single dot.';
const CHUNK_BYTES = 3200;            // 100 ms of 16 kHz mono PCM16
const TAIL_SILENCE_MS = 800;         // lets automatic activity detection see the end of speech
const SETUP_TIMEOUT_MS = 9000;
const TOTAL_TIMEOUT_MS = 12000;
const IDLE_AFTER_TEXT_MS = 600;      // transcript text, then nothing new for this long -> done

function liveUrl(apiKey) {
  return `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(apiKey)}`;
}

function buildSetup(model) {
  return {
    setup: {
      model: `models/${model}`,
      generationConfig: { responseModalities: ['AUDIO'] },
      systemInstruction: { parts: [{ text: SILENT_TRANSCRIBER }] },
      inputAudioTranscription: {},
      realtimeInputConfig: { automaticActivityDetection: { disabled: false, startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH', endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH', prefixPaddingMs: 120, silenceDurationMs: 300 } },
    },
  };
}

function statusFromClose(code) { return code === 1013 ? 429 : code === 1011 ? 503 : code === 1008 ? 400 : 0; }

/**
 * Transcribes ONE short PCM16/16 kHz clip with a throwaway Gemini Live session.
 * Resolves with the transcript ('' when no clear speech). Rejects (with .status) when the model/session failed,
 * so the caller can move down the ladder.
 */
function transcribeClipLive({ WebSocket, apiKey, model, pcm, timeoutMs = TOTAL_TIMEOUT_MS, setupTimeoutMs = SETUP_TIMEOUT_MS, idleAfterTextMs = IDLE_AFTER_TEXT_MS, tailSilenceMs = TAIL_SILENCE_MS }) {
  return new Promise((resolve, reject) => {
    let socket = null;
    let done = false;
    let setupDone = false;
    let transcript = '';
    let idleTimer = null;
    let setupTimer = null;
    let totalTimer = null;

    const cleanup = () => {
      clearTimeout(idleTimer); clearTimeout(setupTimer); clearTimeout(totalTimer);
      if (socket) {
        try { socket.removeAllListeners?.('message'); } catch { /* ignore */ }
        try { socket.close(1000, 'wake clip done'); } catch { try { socket.terminate(); } catch { /* ignore */ } }
      }
    };
    const succeed = () => { if (done) return; done = true; cleanup(); resolve(transcript.trim()); };
    const fail = (error) => { if (done) return; done = true; cleanup(); reject(error); };

    try { socket = new WebSocket(liveUrl(apiKey), { handshakeTimeout: 8000, perMessageDeflate: false, maxPayload: 4 * 1024 * 1024 }); }
    catch (error) { fail(error); return; }

    setupTimer = setTimeout(() => { const e = new Error(`Gemini Live wake setup timed out for ${model}.`); e.status = 504; fail(e); }, setupTimeoutMs);
    totalTimer = setTimeout(() => {
      if (setupDone) succeed();                                  // we asked, the model was slow: use whatever was heard
      else { const e = new Error(`Gemini Live wake check timed out for ${model}.`); e.status = 504; fail(e); }
    }, timeoutMs);

    socket.once('open', () => {
      try { socket.send(JSON.stringify(buildSetup(model))); } catch (error) { fail(error); }
    });

    socket.on('unexpected-response', (_request, response) => {
      const chunks = [];
      response.on('data', (chunk) => { if (chunks.length < 32) chunks.push(Buffer.from(chunk)); });
      response.on('end', () => {
        let detail = '';
        try { detail = JSON.parse(Buffer.concat(chunks).toString('utf8'))?.error?.message || ''; } catch { /* ignore */ }
        const error = new Error(detail || `Gemini Live HTTP ${response.statusCode} for ${model}.`);
        error.status = response.statusCode;
        fail(error);
      });
    });

    socket.on('error', (error) => { fail(error); });

    socket.on('close', (code, reason) => {
      if (done) return;
      if (setupDone) { succeed(); return; }                      // closed after we sent the clip: use what we have
      const detail = reason ? Buffer.from(reason).toString('utf8').slice(0, 160) : `close code ${code}`;
      const error = new Error(`Gemini Live closed during wake setup for ${model}: ${detail}`);
      error.status = statusFromClose(code);
      fail(error);
    });

    socket.on('message', (data) => {
      if (done) return;
      let message;
      try { message = JSON.parse(Buffer.from(data).toString('utf8')); } catch { return; }
      if (message.error) {
        const error = new Error(message.error.message || `Gemini Live rejected ${model}.`);
        error.status = message.error.code || 0;
        fail(error);
        return;
      }
      if (message.setupComplete) {
        setupDone = true;
        clearTimeout(setupTimer);
        sendClip();
        return;
      }
      const content = message.serverContent;
      if (!content) return;
      const input = content.inputTranscription;
      if (input?.text) {
        transcript = mergeTranscriptFragments(transcript, input.text);
        clearTimeout(idleTimer);
        idleTimer = setTimeout(succeed, idleAfterTextMs);
        if (input.finished === true) succeed();
      }
      // The model started its own reply (or finished): the user's turn, and so the transcript, is complete.
      if (content.modelTurn || content.turnComplete || content.generationComplete) {
        if (transcript) succeed();
        else if (content.turnComplete || content.generationComplete) { clearTimeout(idleTimer); idleTimer = setTimeout(succeed, 250); }
      }
    });

    function sendClip() {
      try {
        const boosted = boostPcm(pcm);                          // quiet microphones: auto-gain like the reference's _boost()
        const all = Buffer.concat([boosted, Buffer.alloc(Math.round(16 * tailSilenceMs) * 2)]);
        for (let offset = 0; offset < all.length; offset += CHUNK_BYTES) {
          socket.send(JSON.stringify({ realtimeInput: { audio: { data: all.subarray(offset, offset + CHUNK_BYTES).toString('base64'), mimeType: 'audio/pcm;rate=16000' } } }));
        }
        socket.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
      } catch (error) { fail(error); }
    }
  });
}

module.exports = { transcribeClipLive, buildSetup, SILENT_TRANSCRIBER };
