"""גילוי משניות, וקריאה/כתיבה של project.json (ה-single source of truth לכל משנה).

מבנה תיקיות:
  data/podcasts/<...>/<basename>.mp3   (+ .srt אופציונלי)  — נכסים גולמיים, לא נוגעים
  data/studio/<mishna_id>/project.json                      — מצב העריכה
  data/studio/<mishna_id>/<slot>.png                        — תמונות שנוצרו
  data/studio/<mishna_id>/output.mp4                         — וידאו מורכב
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from .srt_parser import parse_srt, total_duration

# שורש הפרויקט (תיקייה אחת מעל app/)
ROOT = Path(__file__).resolve().parent.parent
PODCASTS_DIR = ROOT / "data" / "podcasts"
STUDIO_DIR = ROOT / "data" / "studio"
REFERENCES_INDEX = ROOT / "data" / "references" / "index.json"

DEFAULT_IMAGES_PER_MINUTE = 4
DEFAULT_STYLE_DESCRIPTION = "תמונות באווירה יהודית ומתאימה לילדים בסגנון 3D PIXAR כמו דמויות WORLD DISNEY"
# שם הקובץ או המזהה של תמונת הסגנון המוגדרת מראש
DEFAULT_STYLE_REF_NAME = "פרק א משנה א.png"


def _slugify(text: str) -> str:
    """מזהה בטוח לקובץ/URL — שומר עברית, מחליף רווחים ותווים בעייתיים במקף."""
    text = text.strip().replace(" ", "-")
    text = re.sub(r"[\\/:*?\"<>|]+", "-", text)
    return re.sub(r"-{2,}", "-", text).strip("-")


def mishna_id_for(mp3_path: Path) -> str:
    rel = mp3_path.relative_to(PODCASTS_DIR).with_suffix("")
    return _slugify("__".join(rel.parts))


def discover_mishnayot() -> list[dict]:
    """סורק את data/podcasts ומחזיר רשימת משניות (כל mp3 = משנה)."""
    results: list[dict] = []
    if not PODCASTS_DIR.exists():
        return results
    for mp3 in sorted(PODCASTS_DIR.rglob("*.mp3")):
        srt = mp3.with_suffix(".srt")
        mid = mishna_id_for(mp3)
        results.append(
            {
                "mishna_id": mid,
                "title": mp3.stem,
                "rel_path": str(mp3.relative_to(ROOT)).replace("\\", "/"),
                "has_srt": srt.exists(),
                "has_project": (STUDIO_DIR / mid / "project.json").exists(),
            }
        )
    return results


def _find_mp3_by_id(mishna_id: str) -> Path | None:
    for mp3 in PODCASTS_DIR.rglob("*.mp3"):
        if mishna_id_for(mp3) == mishna_id:
            return mp3
    return None


def _create_minute_slots(total_duration: float, images_per_minute, srt_path: str = None) -> list[dict]:
    """יוצר משבצת אחת לכל דקה עם 4 sub-slots (סצנות) ריקים."""
    from .srt_parser import seconds_to_timestamp
    
    slots = []
    num_minutes = int(total_duration / 60) + (1 if total_duration % 60 > 0 else 0)
    
    try:
        ipm = int(float(images_per_minute))
    except (ValueError, TypeError):
        ipm = 4
        
    for minute_idx in range(num_minutes):
        minute_start = minute_idx * 60
        minute_end = min((minute_idx + 1) * 60, total_duration)
        
        # יצירת 4 sub-slots ריקים לכל דקה (ימולאו ע״י Claude)
        scenes = []
        for scene_idx in range(ipm):
            scenes.append({
                "scene_id": f"scene-{scene_idx + 1}",
                "start": "",  # Claude ימלא את התזמון המדויק
                "end": "",
                "mishna_text": "",
                "prompt": "",
                "references": [],
                "duration": 0.0,
                "image_path": None,
                "status": "proposed",
            })
        
        slots.append({
            "id": f"minute-{minute_idx + 1:03d}",
            "minute_index": minute_idx,
            "start": seconds_to_timestamp(minute_start),
            "end": seconds_to_timestamp(minute_end),
            "duration": minute_end - minute_start,
            "scenes": scenes,
            "status": "proposed",
        })
    
    return slots


def studio_dir(mishna_id: str) -> Path:
    d = STUDIO_DIR / mishna_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def project_path(mishna_id: str) -> Path:
    return studio_dir(mishna_id) / "project.json"


def load_or_init_project(mishna_id: str) -> dict:
    """טוען project.json קיים, או יוצר שלד ריק מ-SRT (יוצר משבצות דקה עם sub-slots)."""
    p = project_path(mishna_id)
    if p.exists():
        with open(p, "r", encoding="utf-8") as f:
            project = json.load(f)
        
        # הגדרת ברירת מחדל לסגנון אם חסר
        changed = False
        if not project.get("style_description"):
            project["style_description"] = DEFAULT_STYLE_DESCRIPTION
            changed = True
        if not project.get("style_references"):
            # נחפש את ה-ID של תמונת ברירת המחדל
            refs = load_references()
            default_ref_id = None
            for r in refs.get("references", []):
                if r.get("file") == DEFAULT_STYLE_REF_NAME or r.get("name") == DEFAULT_STYLE_REF_NAME:
                    default_ref_id = r["id"]
                    break
            if default_ref_id:
                project["style_references"] = [default_ref_id]
                changed = True

        # אם יש משבצות ישנות (לפי שורות ולא לפי דקות), נמחק אותן וניצור מחדש
        has_old_slots = project.get("slots") and not project["slots"][0].get("scenes")
        
        if (not project.get("slots") or has_old_slots) and project.get("srt_path"):
            srt = ROOT / project["srt_path"]
            if srt.exists():
                cues = parse_srt(str(srt))
                duration = total_duration(cues)
                project["slots"] = _create_minute_slots(duration, project.get("images_per_minute", DEFAULT_IMAGES_PER_MINUTE))
                changed = True
        
        if changed:
            save_project(project)
            
        return project

    mp3 = _find_mp3_by_id(mishna_id)
    if mp3 is None:
        raise FileNotFoundError(f"לא נמצאה משנה עם המזהה {mishna_id}")
    srt = mp3.with_suffix(".srt")

    duration = 0.0
    slots = []
    if srt.exists():
        cues = parse_srt(str(srt))
        duration = total_duration(cues)
        # יצירת משבצות דקה עם sub-slots
        slots = _create_minute_slots(duration, DEFAULT_IMAGES_PER_MINUTE)

    # חיפוש מזהה רפרנס ברירת מחדל
    refs = load_references()
    default_ref_id = None
    for r in refs.get("references", []):
        if r.get("file") == DEFAULT_STYLE_REF_NAME or r.get("name") == DEFAULT_STYLE_REF_NAME:
            default_ref_id = r["id"]
            break

    project = {
        "mishna_id": mishna_id,
        "title": mp3.stem,
        "audio_path": str(mp3.relative_to(ROOT)).replace("\\", "/"),
        "srt_path": str(srt.relative_to(ROOT)).replace("\\", "/") if srt.exists() else None,
        "audio_duration": duration,
        "images_per_minute": DEFAULT_IMAGES_PER_MINUTE,
        "style_description": DEFAULT_STYLE_DESCRIPTION,
        "style_references": [default_ref_id] if default_ref_id else [],
        "slots": slots,
    }
    save_project(project)
    return project


def save_project(project: dict) -> None:
    p = project_path(project["mishna_id"])
    with open(p, "w", encoding="utf-8") as f:
        json.dump(project, f, ensure_ascii=False, indent=2)


def create_custom_project(mishna_id: str, plot: str, srt_text: str, images_per_minute: int) -> dict:
    # שמירת עלילה ו-SRT בקבצים בתיקיית הסטודיו של הפרויקט
    d = studio_dir(mishna_id)
    plot_path = d / "plot.txt"
    srt_path = d / "transcription.srt"
    
    with open(plot_path, "w", encoding="utf-8") as f:
        f.write(plot)
    with open(srt_path, "w", encoding="utf-8") as f:
        f.write(srt_text)
        
    from .srt_parser import parse_srt, total_duration
    cues = parse_srt(str(srt_path))
    duration = total_duration(cues)
    
    slots = _create_minute_slots(duration, images_per_minute)
    
    # חיפוש מזהה רפרנס ברירת מחדל
    refs = load_references()
    default_ref_id = None
    for r in refs.get("references", []):
        if r.get("file") == DEFAULT_STYLE_REF_NAME or r.get("name") == DEFAULT_STYLE_REF_NAME:
            default_ref_id = r["id"]
            break

    project = {
        "mishna_id": mishna_id,
        "title": mishna_id,
        "audio_path": "", # אין עדיין
        "srt_path": str(srt_path.relative_to(ROOT)).replace("\\", "/"),
        "plot_path": str(plot_path.relative_to(ROOT)).replace("\\", "/"),
        "audio_duration": duration,
        "images_per_minute": images_per_minute,
        "style_description": DEFAULT_STYLE_DESCRIPTION,
        "style_references": [default_ref_id] if default_ref_id else [],
        "slots": slots,
    }
    save_project(project)
    return project

def get_slot(project: dict, slot_id: str) -> dict | None:
    for s in project.get("slots", []):
        if s.get("id") == slot_id:
            return s
    return None


def load_references() -> dict:
    if not REFERENCES_INDEX.exists():
        return {"base_dir": "data/images", "references": []}
    with open(REFERENCES_INDEX, "r", encoding="utf-8") as f:
        return json.load(f)


def reference_file_path(ref_value: str, version_index: int = -1) -> Path | None:
    """ממיר ערך reference (id או שם קובץ) לנתיב מוחלט בדיסק.
    אם version_index >= 0, יחזיר את הגרסה הספציפית מהרשימה.
    """
    refs = load_references()
    base = ROOT / refs.get("base_dir", "data/images")
    for r in refs.get("references", []):
        if ref_value in (r.get("id"), r.get("file"), r.get("name")):
            if version_index >= 0 and r.get("versions") and version_index < len(r["versions"]):
                return base / r["versions"][version_index]["file"]
            return base / r["file"]
    # אולי הועבר שם קובץ ישיר
    candidate = base / ref_value
    return candidate if candidate.exists() else None

def add_reference(filename: str, content: bytes, name: str, description: str, category: str) -> dict:
    refs = load_references()
    base = ROOT / refs.get("base_dir", "data/images")
    base.mkdir(parents=True, exist_ok=True)
    
    file_path = base / filename
    with open(file_path, "wb") as f:
        f.write(content)
        
    import uuid
    new_ref = {
        "id": f"ref-{uuid.uuid4().hex[:8]}",
        "file": filename,
        "name": name,
        "description": description,
        "category": category,
        "age": None,
        "height": None,
        "items": [],
        "dormant": False,
        "versions": []
    }
    
    refs.setdefault("references", []).append(new_ref)
    with open(REFERENCES_INDEX, "w", encoding="utf-8") as f:
        json.dump(refs, f, ensure_ascii=False, indent=2)
        
    return new_ref
