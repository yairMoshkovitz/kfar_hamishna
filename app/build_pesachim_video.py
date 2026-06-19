import argparse
import json
import shutil
import subprocess
from pathlib import Path

# דוגמא
# python app/build_pesachim_video.py --json "C:\Users\MyPC\Downloads\pesachim_scenes.json" --images "data\images\pesachim_v1" --audio "data\podcasts\psachim\perek-3\פסחים-ג-א.mp3" --output "data\studio\pesachim_final.mp4"

WIDTH = 1920
HEIGHT = 1080

def _ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if not exe:
        raise RuntimeError("ffmpeg לא נמצא ב-PATH")
    return exe

def main():
    parser = argparse.ArgumentParser(description="הרכבת סרטון מתמונות, קובץ JSON עם זמנים וקובץ אודיו.")
    parser.add_argument("--json", required=True, type=Path, help="נתיב לקובץ ה-JSON שמכיל את נתוני הסצינות והזמנים")
    parser.add_argument("--images", required=True, type=Path, help="נתיב לתיקייה שמכילה את התמונות")
    parser.add_argument("--audio", required=True, type=Path, help="נתיב לקובץ האודיו")
    parser.add_argument("--output", type=Path, default=Path("output_final.mp4"), help="נתיב ושם לקובץ הוידאו שיווצר")
    
    args = parser.parse_args()
    
    scenes_json_path = args.json
    images_dir = args.images
    audio_path = args.audio
    output_video_path = args.output
    
    output_dir = output_video_path.parent
    output_dir.mkdir(parents=True, exist_ok=True)
    
    with open(scenes_json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    scenes = data.get("scenes", [])
    if not scenes:
        print("לא נמצאו סצינות בקובץ ה-JSON.")
        return
        
    list_file = output_dir / "_concat_pesachim.txt"
    lines = []
    
    valid_scenes_count = 0
    
    for i, scene in enumerate(scenes):
        scene_num = scene.get("scene_number", i + 1)
        duration = scene.get("duration_seconds", 5)
        
        img_name = f"scene_{scene_num:02d}.jpg"
        img_path = images_dir / img_name
        
        if not img_path.exists():
            print(f"אזהרה: תמונה חסרה לסצינה {scene_num}: {img_path}")
            # Optional: handle missing images by extending the previous one, 
            # but for now we'll just skip and the duration will be shorter.
            continue
            
        posix_path = str(img_path.resolve()).replace("\\", "/")
        lines.append(f"file '{posix_path}'")
        lines.append(f"duration {duration}")
        valid_scenes_count += 1
        last_valid_img = posix_path

    if valid_scenes_count == 0:
        print("לא נמצאו תמונות בכלל!")
        return

    # concat demuxer requires repeating the last file
    lines.append(f"file '{last_valid_img}'")
    
    list_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"נוצר קובץ concat עם {valid_scenes_count} תמונות.")
    
    vf = (
        f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=decrease,"
        f"pad={WIDTH}:{HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p"
    )
    
    # הבסיס של פקודת ה-ffmpeg
    cmd = [
        _ffmpeg(),
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", str(list_file),
    ]
    
    if audio_path.exists():
        print(f"מוסיף אודיו: {audio_path}")
        cmd.extend(["-i", str(audio_path)])
        # וידאו ייעצר בסוף האודיו או התמונות הקצר מביניהם
        cmd.extend(["-shortest", "-c:a", "aac", "-b:a", "192k"])
    else:
        print(f"לא נמצא קובץ אודיו בנתיב {audio_path}. הוידאו ייווצר ללא קול.")
        
    cmd.extend([
        "-vf", vf,
        "-c:v", "libx264",
        "-r", "25",
        "-pix_fmt", "yuv420p",
        str(output_video_path)
    ])
    
    print(f"מריץ ffmpeg ליצירת הוידאו: {output_video_path.name}...")
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        print(f"שגיאת ffmpeg:\n{proc.stderr[-2000:]}")
    else:
        print(f"הוידאו נוצר בהצלחה בנתיב: {output_video_path}")

if __name__ == "__main__":
    main()
