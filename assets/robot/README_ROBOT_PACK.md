# Nexora Robot Animations v3 — by codewithsempai

14 animation states + voice-synced face effects for the Nexora robot.

## What changed in v2
* Poses re-built from the robot's real skeleton (arms rest in an A-pose, head is large). Every state was
  checked with forward kinematics so hands/arms no longer pass through the head or torso.
* Voice sync: mouth shapes, eye squint on stressed syllables, glow pulse,
  body gestures that scale with voice level.
* New states **error** and **offline** (matching your UI bar: Idle / Listen / Think / Speak / Wake / Error / Offline).
* Eyes follow each state (look up while thinking, down when sad, drift while idle).
* Screen power-on / glitch / screen-off effects fired by the animations.

## What's new in v3 — robot face with human-style expressions & lip sync
New file **`src/nexora-face.js`** (`NexoraFace`) — a stylised *robot* screen face (LED block eyes, bar brows, glowing mouth).
**No nose and no realistic skin detail**: every human expression is carried only by eye shape, brow angle, mouth shape and a soft
screen tint, so it still looks like a robot. Behaves like a person: natural blinking (incl. double blinks), small eye jumps
(saccades), tiny asymmetric micro-expressions, smooth onset/release of expressions.

**7 universal emotions** (Ekman): `happiness sadness anger fear surprise disgust contempt` (+ `neutral`)
| emotion | robot face |
|---|---|
| happiness | eyes become "^" arcs, mouth corners up, light pink blush |
| sadness | drooped eyes, inner brows up, corners down, glossy tear |
| anger | brows lowered + furrowed, narrowed glaring eyes, lips pressed |
| fear | brows raised, wide eyes with pupils, tense slightly-open mouth, cool tint |
| surprise | brows raised, wide eyes, dropped jaw / open mouth |
| disgust | brows lowered, squinted eyes, raised upper lip showing teeth |
| contempt | one mouth corner pulled back (asymmetric) + dimple, rest neutral |

**29 facial actions**
* Mouth & Jaw: smile grin beam smirk sneer frown pout grimace wince gasp sigh yawn purse bitelip clench
* Eyes & Brows: wink blink squint stare glare glower eyeroll raisebrow furrow teary deadpan
* Screen tint: blush flush pale

Timed actions (wink, blink, gasp, sigh, yawn, eyeroll, raisebrow, bitelip, stare) animate and return by themselves; the rest are held poses.

**Real lip sync (visemes)** — `NexoraVoiceSync` outputs `voice.viseme` and `voice.vis = {open, pucker, press, teeth, tongue}`:
M/B/P close the lips, F/V put teeth on the lip, TH/L show the tongue, O/U round the lips, E/I stretch wide, S/Z show teeth.
Works with browser TTS (word-timed), audio files, streams and simulated speech. Emotions and lip sync combine (talk while happy/angry/sad).

```js
const face = new NexoraFace();
face.setEmotion('happiness', 1);   // hold an emotion (intensity 0..1.5)
face.setPose('smirk');             // hold a facial action
face.doAction('wink');             // timed action
face.clear();

// every frame
voice.update(dt, t);
face.update(dt, t, voice);         // lip sync comes from the voice
face.draw(ctx2d, W, H, { color: '#fff', glow: 1, voiceLevel: voice.level, peak: voice.peak, gaze: anim.out.gaze });
```
Body states pick a matching emotion automatically (`NexoraFace.STATE_EMOTION`): happy/greeting -> happiness, sad -> sadness,
surprised -> surprise, error -> anger. In the demo: **Emotions**, **Facial actions**, **Intensity**, a "Body acts the emotion too"
switch (happiness/sadness/anger/surprise also play the matching body animation) and a live viseme read-out. Previews are in `docs/`.

## Run the demo
Open `demo/Nexora_Robot_Animation_Lab.html` in Chrome or Edge (online once, for three.js).
* Top row = the 7 Nexora UI states. "Animations" = all 14 states, "Play all" cycles them.
* **Speak** — browser TTS, mouth follows each word. **Mic** — listening state, face glow follows your voice.
* **Audio file** — pick any voice/music file; the robot "speaks" it with real audio-driven lip sync.
* "Calibrate" checkboxes flip arm / head directions if your rig ever differs.

## States
| UI label | state | motion | face |
|---|---|---|---|
| Idle | idle | breathing, weight shifts, ear twitches, arms relaxed, wandering eyes | calm |
| Listen | listening | head turns to user, forward lean, ears perk | wide eyes, blue |
| Think | thinking | head tilt, hand in front of chest with finger tapping, eyes look up-away | narrow, yellow |
| Speak | speaking | head motion, alternating hand gestures, body sway (scales with voice) | lip sync |
| – | greeting | raises hand beside head and waves | joy |
| – | happy | bouncing hops, open arms, ears wiggle | joy |
| – | confused | head tilts, uneven shoulders, palm-up shrug | puzzled |
| – | sad | head lowers, shoulders/arms/ears droop | sad, blue |
| – | surprised | head snaps up, hop, arms fly out | wow |
| – | sleep | head drops, slow breathing | eyes closed |
| Wake | wakeup | body twitches on, head lifts, arms return, screen boots | sleepy → wow → calm |
| – | goodbye | waves, small bow, back to idle (or offline) | joy |
| Error | error | head shakes "no", jolt, ear flicks, "ugh" hands, red glitch | angry, red |
| Offline | offline | slumps, screen fades to black | off |

One-shot states return to idle by themselves; idle/listening/thinking/speaking/sleep/offline loop.

## Use in Nexora (three.js)
```js
import NexoraAnimator from './nexora-animator.js';
import NexoraVoiceSync from './nexora-voice-sync.js';

const AX    = NexoraAnimator.axesFromForward(THREE, robotForwardVector);   // {F,U,R}
const voice = new NexoraVoiceSync();
const anim  = new NexoraAnimator(THREE, bones, AX, {
  wave: 'R_', goodbyeNext: 'idle',                      // 'offline' for a real shutdown
  onFace:  (name, preset, glow) => setFace(preset, glow), // preset keys = face display keys
  onEvent: ev => { /* 'glitch' | 'boot' | 'screenOn' | 'screenOff' */ }
});

// every frame
voice.update(dt, t);
anim.update(dt, t, { speech: voice.level, userYaw: 0 });
drawFace({ mouthOpen: voice.open, mouthWidth: voice.width, glow: voice.level,
           squint: voice.peak, gaze: anim.out.gaze });

// drive it from the assistant
anim.setUIState('Wake');   anim.setUIState('Listen');  anim.setUIState('Think');
anim.setUIState('Speak');  anim.setUIState('Error');   anim.setUIState('Offline');
anim.setState('greeting'); // happy, confused, sad, surprised, sleep, goodbye ...
```
Voice sources (pick one):
```js
voice.useElement(audioEl);      // AI voice playing in <audio>  -> real lip sync
voice.useStream(mediaStream);   // WebRTC / streamed TTS
await voice.useMic();           // listening: level/glow only, mouth stays closed
voice.speakText('Hello', {});   // browser TTS, word-timed mouth shapes
voice.simulate(true);           // you only know "AI is speaking": synthetic mouth
voice.stop();
```
Face display hooks to wire (see how the demo patches the Nexora face page): mouth open/width from
`voice.open/width`, eye height × (1 − 0.1·voice.peak), glow blur × (1 + voice.level·1.4).

## Tuning
`opts.amp` (strength), `STATES` in `nexora-animator.js` (degrees; arm/ear values mirror left/right),
`armSideSign / armPitchSign / tiltSign` for calibration, `NexoraVoiceSync` options `gain, gate, attack, release`.

Files: `src/nexora-animator.js`, `src/nexora-voice-sync.js`, `src/nexora-face.js`, `demo/`, `assets/Nexora_Robot.fbx`.
