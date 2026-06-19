"""הרכבת וידאו מצגת ב-ffmpeg: תמונות לפי תזמון + שכבת אודיו = mp4 מסונכרן."""
from __future__ import annotations

import shutil
import subprocess
import os
from pathlib import Path

from .srt_parser import timestamp_to_seconds

WIDTH = 1920
HEIGHT = 1080


def _ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if not exe:
        raise RuntimeError("ffmpeg לא נמצא ב-PATH")
    return exe


def build_video_stream(project: dict, audio_abs: Path, out_path: Path):
    """בונה וידאו מהסצנות שיש להן תמונה, מסונכרן לאודיו.
    מחזיר Generator שמזרים את הלוגים של ffmpeg.
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
        yield "Error: אין סצנות עם תמונה — צור ואשר תמונות לפני הרכבה\n"
        return

    studio = out_path.parent
    list_file = studio / "_concat.txt"

    lines = []
    for scene in all_scenes:
        img = (studio / Path(scene["image_path"]).name)
        if not img.exists():
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

    yield f"Starting FFMPEG with command: {' '.join(cmd)}\n"

    # מריץ את התהליך ומאזין ל-stderr (שם ffmpeg מוציא לוגים)
    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT, # ffmpeg logs to stderr by default
        text=True,
        bufsize=1,
        universal_newlines=True
    )

    if process.stdout:
        for line in process.stdout:
            yield line

    process.wait()
    if process.returncode == 0:
        yield "SUCCESS: וידאו הורכב בהצלחה\n"
    else:
        yield f"ERROR: ffmpeg נכשל עם קוד {process.returncode}\n"


def build_video(project: dict, audio_abs: Path, out_path: Path) -> Path:
    """גרסה סינכרונית לשימוש קודם אם נדרש (עוטפת את ה-stream)"""
    for line in build_video_stream(project, audio_abs, out_path):
        print(line, end="")
    return out_path
