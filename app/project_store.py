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
        # אם הפרויקט קיים אבל ריק ממשבצות — מאתחל אותן מה-SRT
        if not project.get("slots") and project.get("srt_path"):
            srt = ROOT / project["srt_path"]
            if srt.exists():
                from .srt_parser import parse_srt, seconds_to_timestamp
                cues = parse_srt(str(srt))
                duration = total_duration(cues)
                project["slots"] = _create_minute_slots(duration, project.get("images_per_minute", DEFAULT_IMAGES_PER_MINUTE))
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

    project = {
        "mishna_id": mishna_id,
        "title": mp3.stem,
        "audio_path": str(mp3.relative_to(ROOT)).replace("\\", "/"),
        "srt_path": str(srt.relative_to(ROOT)).replace("\\", "/") if srt.exists() else None,
        "audio_duration": duration,
        "images_per_minute": DEFAULT_IMAGES_PER_MINUTE,
        "slots": slots,
    }
    save_project(project)
    return project


def save_project(project: dict) -> None:
    p = project_path(project["mishna_id"])
    with open(p, "w", encoding="utf-8") as f:
        json.dump(project, f, ensure_ascii=False, indent=2)


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


def reference_file_path(ref_value: str) -> Path | None:
    """ממיר ערך reference (id או שם קובץ) לנתיב מוחלט בדיסק."""
    refs = load_references()
    base = ROOT / refs.get("base_dir", "data/images")
    for r in refs.get("references", []):
        if ref_value in (r.get("id"), r.get("file"), r.get("name")):
            return base / r["file"]
    # אולי הועבר שם קובץ ישיר
    candidate = base / ref_value
    return candidate if candidate.exists() else None
