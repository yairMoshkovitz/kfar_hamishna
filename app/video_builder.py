"""הרכבת וידאו מצגת ב-ffmpeg: תמונות לפי תזמון + אפקטי תנועה + שכבת אודיו = mp4 מסונכרן.

כל תמונה הופכת לקליפ וידאו קצר (ללא אודיו) עם אפקט zoompan, ואז הקליפים מחוברים.
האודיו מתווסף פעם אחת בלבד, כשכבה רציפה אחת מעל כל הווידאו — אין תפרים באודיו.
"""
from __future__ import annotations

import shutil
import subprocess
import os
from pathlib import Path

from .srt_parser import timestamp_to_seconds
from . import effects

WIDTH = 1920
HEIGHT = 1080
FPS = 25


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
                start_sec = timestamp_to_seconds(scene.get("start", "00:00:00.000"))
                end_sec = timestamp_to_seconds(scene.get("end", "00:00:00.000"))
                duration = end_sec - start_sec
                if duration <= 0:
                    duration = scene.get("duration", 5.0)
                
                all_scenes.append({
                    "image_path": scene["image_path"],
                    "start": scene.get("start", ""),
                    "start_sec": start_sec,
                    "duration": duration,
                    "effect": scene.get("effect", effects.DEFAULT_EFFECT),
                    "intensity": scene.get("intensity", effects.DEFAULT_INTENSITY),
                })

    # מיון לפי timestamp
    all_scenes.sort(key=lambda s: s["start_sec"])

    if not all_scenes:
        yield "Error: אין סצנות עם תמונה — צור ואשר תמונות לפני הרכבה\n"
        return

    # ---------- תזמון מוחלט: כל סצנה מוחזקת על המסך עד שהסצנה הבאה מתחילה ----------
    # כך הזמן המצטבר של הקליפים תואם בדיוק את ה-timestamp של כל סצנה, והאודיו נשאר מסונכרן.
    for i, scene in enumerate(all_scenes):
        if i + 1 < len(all_scenes):
            # משך = הפער עד תחילת הסצנה הבאה (בולע רווחים, מתעלם מחפיפות קלות)
            scene["duration"] = all_scenes[i + 1]["start_sec"] - scene["start_sec"]
        # הסצנה האחרונה שומרת על ה-duration המקורי שלה (end-start)

    # פער פתיחה לפני הסצנה הראשונה — קטע שחור כדי שהסצנה הראשונה תיפול ב-timestamp הנכון
    lead_in = max(0.0, all_scenes[0]["start_sec"])

    studio = out_path.parent
    ffmpeg = _ffmpeg()
    total = len(all_scenes)

    # ---------- שלב א': קליפ וידאו קצר (ללא אודיו) לכל תמונה, עם אפקט ----------
    clip_paths: list[Path] = []

    # קליפ שחור פותח אם הסצנה הראשונה לא מתחילה ב-0 — שומר על סנכרון עם האודיו מההתחלה
    if lead_in > 0.05:
        black_clip = studio / "_clip_lead.mp4"
        black_cmd = [
            ffmpeg, "-y",
            "-f", "lavfi",
            "-i", f"color=c=black:s={WIDTH}x{HEIGHT}:r={FPS}",
            "-t", f"{lead_in:.3f}",
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-an",
            str(black_clip),
        ]
        yield f"מעבד קטע פתיחה שחור ({lead_in:.2f} שניות)...\n"
        result = subprocess.run(
            black_cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace",
        )
        if result.returncode != 0:
            yield (result.stdout or "")
            yield f"ERROR: יצירת קטע פתיחה נכשלה (קוד {result.returncode})\n"
            return
        clip_paths.append(black_clip)

    for i, scene in enumerate(all_scenes):
        img = (studio / Path(scene["image_path"]).name)
        if not img.exists():
            img = Path(scene["image_path"])
        dur = max(0.5, scene["duration"])
        clip = studio / f"_clip_{i:04d}.mp4"
        vf = effects.build_vf(scene["effect"], scene["intensity"], dur, FPS)

        clip_cmd = [
            ffmpeg, "-y",
            "-i", str(img),
            "-vf", vf,
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-r", str(FPS),
            "-an",  # ללא אודיו — האודיו מתווסף רק בהרכבה הסופית
            str(clip),
        ]
        yield f"מעבד קליפ {i + 1}/{total} (אפקט: {scene['effect']}/{scene['intensity']})...\n"
        result = subprocess.run(
            clip_cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace",
        )
        if result.returncode != 0:
            yield (result.stdout or "")
            yield f"ERROR: יצירת קליפ {i + 1} נכשלה (קוד {result.returncode})\n"
            return
        clip_paths.append(clip)

    # ---------- שלב ב': רשימת concat של הקליפים ----------
    list_file = studio / "_concat.txt"
    lines = [f"file '{str(c.resolve()).replace(chr(92), '/')}'" for c in clip_paths]
    list_file.write_text("\n".join(lines) + "\n", encoding="utf-8")

    # ---------- שלב ג': חיבור הווידאו + הוספת האודיו הרציף פעם אחת ----------
    cmd = [
        ffmpeg, "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", str(list_file),
        "-i", str(audio_abs),
        "-c:v", "copy",
        "-c:a", "aac",
        "-b:a", "192k",
        "-shortest",
        str(out_path),
    ]

    yield f"מרכיב וידאו סופי מ-{total} קליפים + אודיו...\n"
    yield f"Starting FFMPEG with command: {' '.join(cmd)}\n"

    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
        universal_newlines=True,
    )

    if process.stdout:
        for line in process.stdout:
            yield line

    process.wait()

    # ניקוי קבצי הביניים
    for c in clip_paths:
        try:
            c.unlink()
        except OSError:
            pass
    try:
        list_file.unlink()
    except OSError:
        pass

    if process.returncode == 0:
        yield "SUCCESS: וידאו הורכב בהצלחה\n"
    else:
        yield f"ERROR: ffmpeg נכשל עם קוד {process.returncode}\n"


def build_video(project: dict, audio_abs: Path, out_path: Path) -> Path:
    """גרסה סינכרונית לשימוש קודם אם נדרש (עוטפת את ה-stream)"""
    for line in build_video_stream(project, audio_abs, out_path):
        print(line, end="")
    return out_path
