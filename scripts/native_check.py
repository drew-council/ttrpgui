"""Offscreen native rehearsal. Run with uv; never connects to the desktop."""

import argparse
import os
import shutil
import signal
import struct
import subprocess
import tempfile
import time
import uuid
import zlib
from pathlib import Path


def seed_campaign(root, scenario):
    campaign, session, encounter, hero, location = [str(uuid.uuid4()) for _ in range(5)]

    def write(path, text):
        destination = root / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(text)

    write("campaign.toml", f'id = "{campaign}"\nname = "The Flooded Archive"\nroster = ["{hero}"]\n')
    write("characters.toml", f'"{hero}" = 14\n')
    write(f"creatures/{hero}/metadata.toml", f'id = "{hero}"\nname = "Éowyn"\nmax_hp = 20\nac = 16\nkind = "persistent"\nportrait = "missing.png"\n')
    write(f"creatures/{hero}/notes.md", "# Éowyn\n\nKeeper of the northern road.\n")
    write(f"sessions/{session}/metadata.toml", f'id = "{session}"\nname = "Session 4 — Beneath the bridge"\n')
    write(f"sessions/{session}/notes.md", "# Beneath the bridge\n\nFind the archive before the water rises.\n")
    write(f"locations/{location}/metadata.toml", f'id = "{location}"\nname = "Flooded Archive"\naliases = ["Archive"]\n')
    write(f"locations/{location}/notes.md", "# Flooded Archive\n\nThe old bridge conceals its entrance.\n")
    text = f'id = "{encounter}"\nsession = "{session}"\nlocation = "{location}"\nname = "Ambush at the archive"\nstatus = "active"\n'
    for index in range(100):
        participant = str(uuid.uuid4())
        text += f'\n[participants."{participant}"]\nid = "{participant}"\n'
        if index == 0:
            text += f'creature = "{hero}"\npersistent = true\nname = "Éowyn"\nhp = 14\nmax_hp = 20\nac = 16\ninitiative = 19\nportrait = "missing.png"\ndescription = "Holding the bridge"\n'
        else:
            text += f'persistent = false\nname = "Raider {index}"\nhp = {2 if index == 1 else 7}\nmax_hp = 7\nac = 13\ninitiative = {18 if index == 1 else 10}\ndescription = "Wounded scout"\n'
    write(f"sessions/{session}/encounters/{encounter}/metadata.toml", text)
    write(f"sessions/{session}/encounters/{encounter}/notes.md", "# Ambush\n\nRain obscures the far bank.\n")
    if scenario == "note":
        note = str(uuid.uuid4())
        write(f"notes/{note}/metadata.toml", f'id = "{note}"\nname = "Image-rich field journal"\n')
        paragraphs = ["# Image-rich field journal\n\n"]
        assets = root / f"notes/{note}/assets"
        assets.mkdir(parents=True)
        for index in range(100):
            # Deterministic PNG fixtures: standard PNG chunks, no image editor.
            width, height = 200, 120
            rows = bytearray()
            for y in range(height):
                rows.append(0)
                for x in range(width):
                    rows.extend((137, 180, 250) if (x + y + index) % 29 < 14 else (203, 166, 247))
            def chunk(kind, data):
                return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
            image = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")
            (assets / f"scene-{index}.png").write_bytes(image)
            paragraphs.append(f"## Entry {index} — Éowyn\n\n![Archive scene {index}](assets/scene-{index}.png)\n\n")
            for line in range(15):
                paragraphs.append(f"Observation {index}.{line}: **the northern archive** contains [a flooded passage](../../locations/{location}/notes.md). " + "Wrapped prose and Unicode: café, 雨, 🐉. " * 6 + "\n\n")
        write(f"notes/{note}/notes.md", "".join(paragraphs))



def main():
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, default=root / "target/debug/ttrpgui")
    parser.add_argument("--scenario", choices=["combat", "note"], default="combat")
    parser.add_argument("--require-performance", action="store_true", help="Enforce the 60 Hz CPU-frame budget for the note scenario")
    args = parser.parse_args()
    weston = shutil.which("weston")
    capture_tool = shutil.which("weston-screenshooter")
    if not weston or not capture_tool:
        raise RuntimeError("Install Weston in this shell before running the offscreen check")
    configured_driver = os.environ.get("TTRPGUI_SOFTWARE_ICD")
    candidates = [Path(configured_driver)] if configured_driver else [Path("/run/opengl-driver/share/vulkan/icd.d/lvp_icd.x86_64.json"), Path("/usr/share/vulkan/icd.d/lvp_icd.x86_64.json")]
    software_driver = next((path for path in candidates if path.is_file()), None)
    if software_driver is None:
        raise RuntimeError("A Mesa lavapipe software Vulkan driver is required for this check")
    artifacts = root / f".editor-proof/native-{args.scenario}"
    artifacts.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="ttrpgui-display-") as directory:
        runtime = Path(directory)
        runtime.chmod(0o700)
        campaign = runtime / "campaign"
        seed_campaign(campaign, args.scenario)
        env = dict(os.environ)
        for name in ["DISPLAY", "WAYLAND_SOCKET", "DBUS_SESSION_BUS_ADDRESS", "HYPRLAND_INSTANCE_SIGNATURE", "SWAYSOCK"]:
            env.pop(name, None)
        env.update(XDG_RUNTIME_DIR=str(runtime), WAYLAND_DISPLAY="ttrpgui-proof",
                   TTRPGUI_DATA_DIR=str(runtime / "application-data"),
                   TTRPGUI_NATIVE_CHECK=args.scenario,
                   VK_ICD_FILENAMES=str(software_driver), LIBGL_ALWAYS_SOFTWARE="1",
                   GALLIUM_DRIVER="llvmpipe", LP_NUM_THREADS="2")
        if args.require_performance:
            env["TTRPGUI_CHECK_PERFORMANCE"] = "1"
        children = []
        previous = set(artifacts.glob("*.png"))
        try:
            with (artifacts / "weston.log").open("w") as compositor_log, (artifacts / "application.log").open("w") as app_log:
                compositor = subprocess.Popen([weston, "--backend=headless", "--fake-seat", "--renderer=pixman", "--shell=kiosk-shell.so", "--width=1440", "--height=900", "--socket=ttrpgui-proof", "--idle-time=0", "--no-config", "--debug"], env=env, stdout=compositor_log, stderr=subprocess.STDOUT, start_new_session=True)
                children.append(compositor)
                deadline = time.monotonic() + 5
                while not (runtime / "ttrpgui-proof").exists():
                    if compositor.poll() is not None or time.monotonic() > deadline:
                        raise RuntimeError("Isolated compositor failed; see weston.log")
                    time.sleep(0.1)
                app = subprocess.Popen([str(args.binary.resolve()), "--campaign", str(campaign)], env=env, stdout=app_log, stderr=subprocess.STDOUT, start_new_session=True)
                children.append(app)
                deadline = time.monotonic() + 12
                while "Rendered first frame" not in (artifacts / "application.log").read_text():
                    if app.poll() is not None or time.monotonic() > deadline:
                        raise RuntimeError("Application failed to render; see application.log")
                    time.sleep(0.2)
                if args.scenario == "note":
                    deadline = time.monotonic() + 15
                    while "Native note probe completed successfully." not in (artifacts / "application.log").read_text():
                        log = (artifacts / "application.log").read_text()
                        if "Native editor check failed:" in log or app.poll() is not None or time.monotonic() > deadline:
                            raise RuntimeError("Native Markdown presentation was not verified; see application.log")
                        time.sleep(0.1)
                    if "Native editor check failed:" in (artifacts / "application.log").read_text():
                        raise RuntimeError("Native Markdown performance gate failed; see application.log")
                else:
                    time.sleep(1)
                capture = subprocess.run([capture_tool], env=env, cwd=artifacts, capture_output=True, text=True, timeout=5, check=False)
                (artifacts / "capture.log").write_text(capture.stdout + capture.stderr)
                if capture.returncode:
                    raise RuntimeError("Screenshot failed; see capture.log")
                print("Native campaign rendered on a private software Wayland display.")
                for path in set(artifacts.glob("*.png")) - previous:
                    print(path)
        finally:
            for child in reversed(children):
                if child.poll() is None:
                    os.killpg(child.pid, signal.SIGTERM)
                    try:
                        child.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        os.killpg(child.pid, signal.SIGKILL)
                        child.wait()


if __name__ == "__main__":
    main()
