"""הרכבת וידאו מצגת ב-ffmpeg: תמונות לפי תזמון + שכבת אודיו = mp4 מסונכרן."""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from .srt_parser import timestamp_to_seconds

WIDTH = 1920
HEIGHT = 1080


def _ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if not exe:
        raise RuntimeError("ffmpeg לא נמצא ב-PATH")
    return exe


def build_video(project: dict, audio_abs: Path, out_path: Path) -> Path:
    """בונה וידאו מהסצנות שיש להן תמונה, מסונכרן לאודיו.

    עובר על כל משבצת דקה, ובתוכה על כל הסצנות.
    משך כל תמונה = duration של הסצנה (מתוך התזמון המדויק של Claude).
    """
    minute_slots = project.get("slots", [])
    
    # אוסף את כל הסצנות עם תמונות מכל משבצות הדקה
    all_scenes = []
    for minute_slot in minute_slots:
        for scene in minute_slot.get("scenes", []):
            if scene.get("image_path"):
                all_scenes.append({
                    "image_path": scene["image_path"],
                    "start": scene.get("start", ""),
                    "duration": scene.get("duration", 5.0),
                })
    
    # מיון לפי timestamp
    all_scenes.sort(key=lambda s: timestamp_to_seconds(s["start"]) if s["start"] else 0)
    
    if not all_scenes:
        raise RuntimeError("אין סצנות עם תמונה — צור ואשר תמונות לפני הרכבה")

    studio = out_path.parent
    list_file = studio / "_concat.txt"

    lines = []
    for scene in all_scenes:
        img = (studio / Path(scene["image_path"]).name)
        if not img.exists():
            # ייתכן ש-image_path הוא נתיב יחסי אחר
            img = Path(scene["image_path"])
        dur = max(0.5, scene["duration"])
        posix = str(img.resolve()).replace("\\", "/")
        lines.append(f"file '{posix}'")
        lines.append(f"duration {dur:.3f}")
    
    # concat demuxer דורש חזרה על הקובץ האחרון
    last_img = (studio / Path(all_scenes[-1]["image_path"]).name)
    if not last_img.exists():
        last_img = Path(all_scenes[-1]["image_path"])
    lines.append(f"file '{str(last_img.resolve()).replace(chr(92), '/')}'")

    list_file.write_text("\n".join(lines) + "\n", encoding="utf-8")

    vf = (
        f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=decrease,"
        f"pad={WIDTH}:{HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p"
    )

    cmd = [
        _ffmpeg(),
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", str(list_file),
        "-i", str(audio_abs),
        "-vf", vf,
        "-c:v", "libx264",
        "-r", "25",
        "-c:a", "aac",
        "-b:a", "192k",
        "-shortest",
        str(out_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg נכשל:\n{proc.stderr[-2000:]}")
    return out_path
