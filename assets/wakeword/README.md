# NEXORA offline wake word (ONNX)

NEXORA listens for its name **locally**: no audio leaves the PC while it waits for "Hey Nexora".

| File | What it is |
|---|---|
| `melspectrogram.onnx`, `embedding_model.onnx` | openWakeWord shared front end (audio -> 96-d speech embeddings). Apache-2.0, from https://github.com/dscripka/openWakeWord (release v0.5.1). |
| `hey_nexora.onnx`, `hey_nexo.onnx`, `nexora.onnx`, `nexo.onnx` | Your trained wake-phrase heads. Input `[1,16,96]`, output a 0-1 score. |

**Add another phrase:** drop any openWakeWord-style `*.onnx` head in this folder (same `[1,16,96]` input). Every file except the two front-end models is loaded automatically and shown as "Hey Foo" from its file name.

**Tuning:** Settings > Voice > *Wake sensitivity* (config key `voice.wakeThreshold`, default 0.6). Lower = easier to trigger, higher = fewer false wakes.
