# ULTRON — Multi-Device Voice Orchestration System

Voice → intent → concurrent ADB dispatch → live HUD.

## Prerequisites

- Python 3.10+
- `adb` installed and on your PATH (Android Platform Tools)
- Each target phone: USB debugging enabled, and authorized once via the
  "Allow USB debugging?" prompt (or connected over wireless ADB)

## Setup

```bash
pip install -r requirements.txt
```

Edit `config.yaml`:
1. Run `adb devices -l` and copy each device's serial into `devices.*.serial`.
2. Set `unlock_method` per device (`"pin"`, `"swipe"`, or `"none"`).
3. Adjust `groups` to match how you'll refer to devices by voice
   ("all", "living_room", etc.).

## Run

Terminal 1 — start the orchestrator (voice listener + dispatcher + WebSocket server):
```bash
python orchestrator.py
```

Terminal 2 (or just double-click) — open the HUD:
```
dashboard/index.html
```
It connects to `ws://localhost:8765` automatically and reacts live as
commands come in.

## Example voice commands

- "Unlock all phones"
- "Open YouTube on the living room phones"
- "Search YouTube for lofi hip hop on phone one"
- "Play this on all devices" (with a resolved URL from a prior search)
- "Set volume to 10 on all phones"

## Latency optimization checklist

1. **Whisper model size vs. speed** — `base` + `int8` on CPU is the
   sweet spot for command-length utterances. Only go to `small`/`medium`
   if you're seeing transcription errors that matter; each step up
   roughly doubles latency.
2. **VAD-gated capture** — the listener only transcribes after it
   detects ~600ms of trailing silence, so you're not running inference
   on dead air. Tune `SILENCE_FRAMES_TO_END` in `voice_listener.py` —
   lower it for snappier cutoffs, raise it if commands get cut off mid-sentence.
3. **Concurrent ADB dispatch** — every device action in `actions.py`
   is fired via `asyncio.gather`, so N devices cost the same wall time
   as 1. Never add a blocking `subprocess.run()` call into the hot path —
   always use the async `dm.shell()` / `dm.run_adb()` wrappers.
4. **Keep ADB connections warm** — `adb connect` wireless devices once
   at startup rather than reconnecting per command; TCP handshake
   overhead is the single biggest avoidable latency source on wireless ADB.
5. **Offline intent parsing** — commands are parsed locally in
   `intent_parser.py`; no account, API key, or internet connection is
   needed after the speech model is available.
6. **GPU for Whisper** — if you have a CUDA GPU, set
   `device: "cuda"` and `compute_type: "int8_float16"` in `config.yaml`
   for a further latency drop on longer utterances.

## Extending

- **New action**: add a function to `actions.py`, add a branch to
  `Orchestrator.handle_action()`, and add the matching offline parsing
  rule to `IntentParser.parse()`.
- **Wake word** instead of always-on VAD capture: swap the VAD trigger
  in `voice_listener.py` for a keyword-spotting library (e.g. Porcupine)
  gating when `listen_forever()` starts buffering.
- **Real YouTube search resolution**: `synchronized_play` currently
  expects a resolved URL; wire in the YouTube Data API to turn a
  spoken query into a `videoId` before dispatch if you want true
  "play the first result" behavior.

## Security note

This system executes real actions on real devices the moment a voice
command is parsed. If it'll run somewhere other people can be overheard
(e.g. a shared room), consider adding a push-to-talk gate or a wake
word with a short confirmation step for anything destructive (uninstalls,
factory resets, etc.) before wiring those actions in.
