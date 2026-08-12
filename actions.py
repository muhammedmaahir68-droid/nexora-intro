"""
actions.py
Concrete ADB action implementations. Each function takes a DeviceManager
and a Device, and is designed to be passed into DeviceManager.dispatch()
via a lambda/partial so it runs concurrently across all targeted devices.
"""

from device_manager import DeviceManager, Device


# ---------- screen / unlock ----------

async def wake_screen(dm: DeviceManager, dev: Device):
    await dm.shell(dev.serial, "input keyevent KEYCODE_WAKEUP")


async def unlock_device(dm: DeviceManager, dev: Device):
    await wake_screen(dm, dev)
    if dev.unlock_method == "swipe":
        # swipe up from bottom-center — works for most default lock screens
        await dm.shell(dev.serial, "input swipe 540 1800 540 400 300")
    elif dev.unlock_method == "pin" and dev.unlock_pin:
        await dm.shell(dev.serial, "input swipe 540 1800 540 400 300")
        await dm.shell(dev.serial, f"input text {dev.unlock_pin}")
        await dm.shell(dev.serial, "input keyevent KEYCODE_ENTER")
    # "none" → screen is already unlocked or has no lock, nothing to do
    return {"status": "unlocked", "device": dev.name}


# ---------- app control ----------

async def launch_app(dm: DeviceManager, dev: Device, package: str):
    code, out, err = await dm.shell(
        dev.serial,
        f"monkey -p {package} -c android.intent.category.LAUNCHER 1",
    )
    return {"status": "launched" if code == 0 else "failed", "package": package, "error": err or None}


async def open_youtube_search(dm: DeviceManager, dev: Device, query: str):
    """Open YouTube directly to search results for `query`."""
    encoded = query.replace(" ", "+")
    intent = (
        f'am start -a android.intent.action.VIEW '
        f'-d "https://www.youtube.com/results?search_query={encoded}" '
        f'com.google.android.youtube'
    )
    code, out, err = await dm.shell(dev.serial, intent)
    return {"status": "opened" if code == 0 else "failed", "query": query, "error": err or None}


async def play_youtube_video(dm: DeviceManager, dev: Device, video_url: str):
    code, out, err = await dm.shell(
        dev.serial,
        f'am start -a android.intent.action.VIEW -d "{video_url}"',
    )
    # give the app a moment to load, then send a tap on the play button area
    # (coordinates are a rough default — tune per device/resolution)
    return {"status": "playing" if code == 0 else "failed", "url": video_url, "error": err or None}


async def set_volume(dm: DeviceManager, dev: Device, level: int):
    """level: 0-15 (Android's default media stream range on most devices)."""
    level = max(0, min(15, level))
    await dm.shell(dev.serial, f"media volume --stream 3 --set {level}")
    return {"status": "volume_set", "level": level}


async def take_screenshot(dm: DeviceManager, dev: Device, local_path: str):
    remote = "/sdcard/ultron_shot.png"
    await dm.shell(dev.serial, f"screencap -p {remote}")
    await dm.run_adb(dev.serial, "pull", remote, local_path)
    return {"status": "captured", "path": local_path}


# ---------- synchronized playback across devices ----------

async def synchronized_play(dm: DeviceManager, target: str, video_url: str, stagger_ms: int = 0):
    """
    Launch the same video on every device in `target` as close to
    simultaneously as possible. All ADB calls fire concurrently;
    `stagger_ms` exists only if you deliberately want a ripple effect
    instead of true sync.
    """
    import asyncio

    async def _play_one(dev: Device):
        if stagger_ms:
            idx = list(dm.resolve_targets(target)).index(dev)
            await asyncio.sleep((idx * stagger_ms) / 1000)
        return await play_youtube_video(dm, dev, video_url)

    return await dm.dispatch(target, _play_one)
