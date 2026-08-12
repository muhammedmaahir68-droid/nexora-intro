"""
dashboard_server.py
Minimal WebSocket broadcast server. The orchestrator calls `broadcast()`
whenever state changes (listening, transcribing, dispatching, device
online/offline, action result) and every connected HUD client receives
it instantly.
"""

import asyncio
import json
import websockets


class DashboardServer:
    def __init__(self, host="localhost", port=8765):
        self.host = host
        self.port = port
        self.clients: set = set()
        self._server = None
        self.system_state: dict | None = None

    async def _handler(self, websocket):
        self.clients.add(websocket)
        try:
            if self.system_state:
                await websocket.send(json.dumps(self.system_state))
            async for _ in websocket:
                pass  # HUD is read-only for now; ignore inbound messages
        finally:
            self.clients.discard(websocket)

    async def start(self):
        self._server = await websockets.serve(self._handler, self.host, self.port)

    async def broadcast(self, event: dict):
        if event.get("type") == "system_state":
            self.system_state = event
        if not self.clients:
            return
        payload = json.dumps(event)
        await asyncio.gather(
            *(c.send(payload) for c in list(self.clients)),
            return_exceptions=True,
        )
