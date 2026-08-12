"""Offline spoken-command parser for ULTRON."""

import re


class IntentParser:
    """Parse supported device commands locally; no cloud service is used."""

    def __init__(self, devices: list[str] | None = None, groups: list[str] | None = None):
        self.devices = set(devices or [])
        self.groups = set(groups or [])

    async def parse(self, transcript: str) -> dict:
        text = " ".join(transcript.lower().strip().split())
        if not text:
            return {"action": "unknown", "reason": "no command was heard"}

        target = self._target(text)
        if re.search(r"\b(unlock|wake up)\b", text):
            return {"action": "unlock_devices", "target": target}
        if re.search(r"\b(screenshot|screen ?shot|capture screen)\b", text):
            return {"action": "screenshot", "target": target}

        volume = re.search(r"\b(?:set )?(?:the )?volume(?: to)?\s+(\d{1,2})\b", text)
        if volume:
            return {"action": "set_volume", "target": target, "level": max(0, min(15, int(volume.group(1))))}

        app = self._app(text)
        if app and re.search(r"\b(open|launch|start)\b", text):
            return {"action": "launch_app", "target": target, "app": app}

        search = re.search(r"\b(?:search(?: youtube)?|find)(?:\s+for)?\s+(.+)", text)
        if search:
            query = self._remove_target_phrase(search.group(1)).strip(" .?!")
            if query:
                return {"action": "youtube_search", "target": target, "query": query}

        url = re.search(r"https?://\S+", transcript)
        if url and re.search(r"\b(play|watch)\b", text):
            return {"action": "play_video", "target": target, "url": url.group(0)}

        return {"action": "unknown", "reason": "Try: unlock, open an app, search YouTube, set volume, screenshot, or play a video URL."}

    def _target(self, text: str) -> str:
        if re.search(r"\b(all|every) (?:phones?|devices?)\b|\ball\b", text):
            return "all"
        for name in sorted(self.groups | self.devices, key=len, reverse=True):
            if re.search(rf"\b{re.escape(name.replace('_', ' '))}\b", text):
                return name
        phone = re.search(r"\bphone\s+(one|two|three|four|five|\d+)\b", text)
        if phone:
            number = {"one": "1", "two": "2", "three": "3", "four": "4", "five": "5"}.get(phone.group(1), phone.group(1))
            candidate = f"phone_{number}"
            if not self.devices or candidate in self.devices:
                return candidate
        return "all"

    @staticmethod
    def _app(text: str) -> str | None:
        for app in ("youtube", "spotify", "chrome", "gallery"):
            if re.search(rf"\b{app}\b", text):
                return app
        return None

    @staticmethod
    def _remove_target_phrase(value: str) -> str:
        return re.split(r"\s+(?:on|to|for)\s+(?:all|every|the|phone|living room)\b", value, maxsplit=1)[0]
