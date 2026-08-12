"""
voice_listener.py
Captures microphone audio, uses WebRTC VAD to detect when someone is
actually speaking (so we're not running Whisper on silence 24/7), and
transcribes completed utterances with faster-whisper.

Latency notes:
- faster-whisper with compute_type="int8" on CPU + model_size="base"
  typically transcribes a 2-3s utterance in well under 1s on modern
  hardware. Use "small"/"medium" only if you need higher accuracy and
  can tolerate more latency, or move to compute_type="int8_float16"
  on GPU for both speed and accuracy.
- VAD-gated capture means transcription only runs on actual speech,
  cutting end-to-end latency versus fixed-window chunking.
"""

import asyncio
import collections
import os
import numpy as np
import sounddevice as sd
import webrtcvad

# Windows can cache Hugging Face model files without symlink support.  The
# fallback is safe; suppress the non-actionable warning for normal users.
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

from faster_whisper import WhisperModel

SAMPLE_RATE = 16000
FRAME_MS = 30                      # webrtcvad requires 10/20/30ms frames
FRAME_SAMPLES = int(SAMPLE_RATE * FRAME_MS / 1000)
SILENCE_FRAMES_TO_END = 20         # ~600ms of silence ends an utterance
VAD_AGGRESSIVENESS = 2             # 0-3, higher = more aggressive filtering


class VoiceListener:
    def __init__(self, model_size="base", device="cpu", compute_type="int8"):
        self.model_size = model_size
        self.device = device
        self.compute_type = compute_type
        self.model = None
        self.vad = webrtcvad.Vad(VAD_AGGRESSIVENESS)
        self._queue: asyncio.Queue[str] = asyncio.Queue()

    async def load_model(self):
        """Load the local model without blocking the dashboard WebSocket."""
        self.model = await asyncio.to_thread(
            WhisperModel, self.model_size, device=self.device, compute_type=self.compute_type
        )

    def _is_speech(self, frame: np.ndarray) -> bool:
        pcm16 = (frame * 32767).astype(np.int16).tobytes()
        return self.vad.is_speech(pcm16, SAMPLE_RATE)

    async def listen_forever(self):
        """
        Runs indefinitely, pushing completed transcripts onto self._queue.
        Call `await listener.next_transcript()` from the orchestrator to
        consume them one at a time.
        """
        loop = asyncio.get_event_loop()
        audio_buffer: list[np.ndarray] = []
        silence_run = 0
        triggered = False

        def callback(indata, frames, time_info, status):
            nonlocal audio_buffer, silence_run, triggered
            frame = indata[:, 0]
            speech = self._is_speech(frame)

            if speech:
                triggered = True
                silence_run = 0
                audio_buffer.append(frame.copy())
            elif triggered:
                silence_run += 1
                audio_buffer.append(frame.copy())
                if silence_run > SILENCE_FRAMES_TO_END:
                    utterance = np.concatenate(audio_buffer)
                    audio_buffer = []
                    triggered = False
                    silence_run = 0
                    asyncio.run_coroutine_threadsafe(
                        self._transcribe_and_enqueue(utterance), loop
                    )

        with sd.InputStream(
            samplerate=SAMPLE_RATE,
            blocksize=FRAME_SAMPLES,
            channels=1,
            dtype="float32",
            callback=callback,
        ):
            while True:
                await asyncio.sleep(0.1)

    async def _transcribe_and_enqueue(self, audio: np.ndarray):
        if self.model is None:
            return
        segments, _ = self.model.transcribe(audio, language="en", beam_size=1)
        text = " ".join(seg.text.strip() for seg in segments).strip()
        if text:
            await self._queue.put(text)

    async def next_transcript(self) -> str:
        return await self._queue.get()
