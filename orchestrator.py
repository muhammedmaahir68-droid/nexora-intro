"""
orchestrator.py
Entry point. Wires together:
  voice_listener  -> intent_parser -> device_manager/actions -> dashboard_server

Run: python orchestrator.py
"""

import asyncio
import functools
import yaml

from device_manager import DeviceManager
from voice_listener import VoiceListener
from intent_parser import IntentParser
from dashboard_server import DashboardServer
import actions

class Orchestrator:
    def __init__(self, config_path="config.yaml"):
        with open(config_path) as f:
            self.config = yaml.safe_load(f)

        self.dm = DeviceManager(self.config)
        self.listener = VoiceListener(**self.config["whisper"])
        self.intents = IntentParser(
            devices=list(self.config.get("devices", {})),
            groups=list(self.config.get("groups", {})),
        )
        self.dashboard = DashboardServer(**self.config["dashboard"])
        self.apps = self.config["apps"]

    async def handle_action(self, intent: dict):
        action = intent.get("action")
        target = intent.get("target", "all")

        await self.dashboard.broadcast({"type": "dispatching", "action": action, "target": target})

        if action == "unlock_devices":
            result = await self.dm.dispatch(target, functools.partial(actions.unlock_device, self.dm))

        elif action == "launch_app":
            pkg = self.apps.get(intent.get("app", ""), intent.get("app", ""))
            result = await self.dm.dispatch(target, functools.partial(actions.launch_app, self.dm, package=pkg))

        elif action == "youtube_search":
            result = await self.dm.dispatch(
                target, functools.partial(actions.open_youtube_search, self.dm, query=intent.get("query", ""))
            )

        elif action == "play_video":
            result = await self.dm.dispatch(
                target, functools.partial(actions.play_youtube_video, self.dm, video_url=intent.get("url", ""))
            )

        elif action == "synchronized_play":
            # NOTE: swap query->url resolution for a real YouTube search API call in production;
            # this boilerplate assumes `intent["url"]` is already resolved upstream if present.
            url = intent.get("url") or intent.get("query", "")
            result = await actions.synchronized_play(self.dm, target, url)

        elif action == "set_volume":
            result = await self.dm.dispatch(
                target, functools.partial(actions.set_volume, self.dm, level=intent.get("level", 8))
            )

        elif action == "screenshot":
            result = await self.dm.dispatch(
                target, functools.partial(actions.take_screenshot, self.dm, local_path="./shot.png")
            )

        else:
            result = {"error": intent.get("reason", "unrecognized command")}

        await self.dashboard.broadcast({"type": "result", "action": action, "result": result})
        return result

    async def voice_loop(self):
        while True:
            transcript = await self.listener.next_transcript()
            await self.dashboard.broadcast({"type": "transcript", "text": transcript})

            intent = await self.intents.parse(transcript)
            await self.dashboard.broadcast({"type": "intent", "intent": intent})

            await self.handle_action(intent)

    async def health_loop(self, interval_s=5):
        while True:
            status = await self.dm.refresh_online_status()
            await self.dashboard.broadcast({"type": "device_status", "status": status})
            await asyncio.sleep(interval_s)

    async def run(self):
        await self.dashboard.start()
        await self.dashboard.broadcast({
            "type": "system_state",
            "state": "DOWNLOADING MODEL",
            "message": "Preparing the local voice model. This happens once.",
        })
        await self.listener.load_model()
        await self.dashboard.broadcast({
            "type": "system_state",
            "state": "LISTENING",
            "message": "Local voice model is ready.",
        })
        await asyncio.gather(
            self.listener.listen_forever(),
            self.voice_loop(),
            self.health_loop(),
        )


if __name__ == "__main__":
    orch = Orchestrator()
    asyncio.run(orch.run())
