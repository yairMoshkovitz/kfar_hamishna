import os
import shutil
import subprocess
from pathlib import Path
import json

def _ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if not exe:
        raise RuntimeError("ffmpeg לא נמצא ב-PATH")
    return exe

def build_custom_video(images_dir: Path, audio_abs: Path, out_path: Path, start_time: str = "00:05:30"):
    """
    חותך את האודיו מזמן מסוים ובונה סרטון מהתמונות שבתיקייה.
    מניח שכל תמונה מקבלת זמן שווה מהאודיו החתוך.
    """
    print(f"Starting build from {start_time}")
    
    # 1. חיתוך האודיו
    cut_audio = images_dir / "cut_audio.mp3"
    cmd_cut = [
        _ffmpeg(),
        "-y",
        "-i", str(audio_abs),
        "-ss", start_time,
        "-c", "copy",
        str(cut_audio)
    ]
    subprocess.run(cmd_cut, check=True)
    
    # בדיקת אורך האודיו החתוך
    cmd_dur = [
        shutil.which("ffprobe") or "ffprobe",
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        str(cut_audio)
    ]
    dur_proc = subprocess.run(cmd_dur, capture_output=True, text=True, check=True)
    audio_duration = float(dur_proc.stdout.strip())
    print(f"Cut audio duration: {audio_duration} seconds")

    # 2. קבלת התמונות וחלוקת זמן
    images = sorted([f for f in images_dir.iterdir() if f.is_file() and f.suffix.lower() in ['.jpg', '.png', '.jpeg']])
    if not images:
        raise RuntimeError(f"לא נמצאו תמונות בתיקייה {images_dir}")
    
    duration_per_image = audio_duration / len(images)
    print(f"Found {len(images)} images. Duration per image: {duration_per_image:.2f}s")

    # 3. יצירת קובץ ה-concat
    list_file = images_dir / "_concat.txt"
    lines = []
    for img in images:
        posix = str(img.resolve()).replace("\\", "/")
        lines.append(f"file '{posix}'")
        lines.append(f"duration {duration_per_image:.3f}")
    
    # concat demuxer דורש חזרה על הקובץ האחרון
    last_img_posix = str(images[-1].resolve()).replace("\\", "/")
    lines.append(f"file '{last_img_posix}'")

    list_file.write_text("\n".join(lines) + "\n", encoding="utf-8")

    # 4. הרכבת הוידאו
    WIDTH = 1920
    HEIGHT = 1080
    vf = (
        f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=decrease,"
        f"pad={WIDTH}:{HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p"
    )

    cmd_concat = [
        _ffmpeg(),
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", str(list_file),
        "-i", str(cut_audio),
        "-vf", vf,
        "-c:v", "libx264",
        "-r", "25",
        "-c:a", "aac",
        "-b:a", "192k",
        "-shortest",
        str(out_path),
    ]
    
    print("Running ffmpeg to generate final video...")
    proc = subprocess.run(cmd_concat, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg נכשל:\n{proc.stderr[-2000:]}")
    
    print(f"Video saved to {out_path}")

if __name__ == "__main__":
    base_dir = Path(os.getcwd())
    images_dir = base_dir / "data" / "studio" / "pesachim_3_1_custom"
    audio_path = base_dir / "data" / "podcasts" / "psachim" / "perek-3" / "פסחים-ג-א.mp3"
    output_path = images_dir / "final_custom_video.mp4"
    
    # User said "מסצאנה 25 והלאה". Scene 25 starts at 01:17 in the SRT file.
    start_time_str = "00:01:17"
    
    if not audio_path.exists():
        print(f"Audio file not found: {audio_path}")
    else:
        try:
            build_custom_video(images_dir, audio_path, output_path, start_time_str)
        except Exception as e:
            print(f"Error: {e}")
