"""גילוי משניות, וקריאה/כתיבה של project.json (ה-single source of truth לכל משנה).

מבנה תיקיות (חדש — עם workspaces):
  data/workspaces.json                              — אינדקס workspaces
  data/workspaces/<ws_id>/workspace.json            — מטא-דאטה של workspace
  data/workspaces/<ws_id>/references/index.json     — רפרנסים של workspace
  data/workspaces/<ws_id>/images/                   — תמונות רפרנס של workspace
  data/workspaces/<ws_id>/studio/<mishna_id>/       — פרויקטים של workspace
  data/podcasts/<...>/<basename>.mp3                — קבצי אודיו גולמיים (גלובלי)
"""
from __future__ import annotations

import json
import re
import shutil
import uuid
from datetime import datetime
from pathlib import Path

from .srt_parser import parse_srt, total_duration

# שורש הפרויקט (תיקייה אחת מעל app/)
ROOT = Path(__file__).resolve().parent.parent
PODCASTS_DIR = ROOT / "data" / "podcasts"
WORKSPACES_DIR = ROOT / "data" / "workspaces"
WORKSPACES_INDEX = ROOT / "data" / "workspaces.json"

# נתיבים ישנים — משמשים רק ל-migration
_LEGACY_STUDIO_DIR = ROOT / "data" / "studio"
_LEGACY_REFERENCES_INDEX = ROOT / "data" / "references" / "index.json"
_LEGACY_IMAGES_DIR = ROOT / "data" / "images"

DEFAULT_WORKSPACE_ID = "ws-default"
DEFAULT_IMAGES_PER_MINUTE = 4
DEFAULT_STYLE_DESCRIPTION = "תמונות באווירה יהודית ומתאימה לילדים בסגנון 3D PIXAR כמו דמויות WORLD DISNEY"
DEFAULT_STYLE_REF_NAME = "פרק א משנה א.png"


def _slugify(text: str) -> str:
    """מזהה בטוח לקובץ/URL — שומר עברית, מחליף רווחים ותווים בעייתיים במקף."""
    text = text.strip().replace(" ", "-")
    text = re.sub(r"[\\/:*?\"<>|]+", "-", text)
    return re.sub(r"-{2,}", "-", text).strip("-")


# ---------- Workspace helpers ----------

def _ws_dir(ws_id: str) -> Path:
    d = WORKSPACES_DIR / ws_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def _ws_studio_dir(ws_id: str) -> Path:
    d = _ws_dir(ws_id) / "studio"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _ws_images_dir(ws_id: str) -> Path:
    d = _ws_dir(ws_id) / "images"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _ws_references_index(ws_id: str) -> Path:
    return _ws_dir(ws_id) / "references" / "index.json"


def _save_workspaces_index(workspaces: list[dict]) -> None:
    WORKSPACES_INDEX.parent.mkdir(parents=True, exist_ok=True)
    with open(WORKSPACES_INDEX, "w", encoding="utf-8") as f:
        json.dump(workspaces, f, ensure_ascii=False, indent=2)


def _migrate_legacy_data() -> None:
    """מעביר נתונים ישנים (data/studio, data/references, data/images) לתוך ws-default."""
    ws_dir = WORKSPACES_DIR / DEFAULT_WORKSPACE_ID

    # כתוב workspace.json
    ws_meta_path = ws_dir / "workspace.json"
    ws_dir.mkdir(parents=True, exist_ok=True)
    if not ws_meta_path.exists():
        with open(ws_meta_path, "w", encoding="utf-8") as f:
            json.dump({
                "id": DEFAULT_WORKSPACE_ID,
                "name": "ברירת מחדל",
                "description": "",
                "created_at": datetime.now().isoformat(),
                "style_defaults": {},
            }, f, ensure_ascii=False, indent=2)

    # העתק studio
    target_studio = ws_dir / "studio"
    if _LEGACY_STUDIO_DIR.exists() and not target_studio.exists():
        shutil.copytree(str(_LEGACY_STUDIO_DIR), str(target_studio))

    # העתק images
    target_images = ws_dir / "images"
    if _LEGACY_IMAGES_DIR.exists() and not target_images.exists():
        shutil.copytree(str(_LEGACY_IMAGES_DIR), str(target_images))

    # העתק references/index.json
    target_refs_dir = ws_dir / "references"
    target_refs_dir.mkdir(parents=True, exist_ok=True)
    target_refs_index = target_refs_dir / "index.json"
    if _LEGACY_REFERENCES_INDEX.exists() and not target_refs_index.exists():
        # שנה את base_dir בתוך האינדקס
        with open(_LEGACY_REFERENCES_INDEX, "r", encoding="utf-8") as f:
            refs = json.load(f)
        refs["base_dir"] = f"data/workspaces/{DEFAULT_WORKSPACE_ID}/images"
        with open(target_refs_index, "w", encoding="utf-8") as f:
            json.dump(refs, f, ensure_ascii=False, indent=2)
    elif not target_refs_index.exists():
        with open(target_refs_index, "w", encoding="utf-8") as f:
            json.dump({"base_dir": f"data/workspaces/{DEFAULT_WORKSPACE_ID}/images", "references": []}, f, ensure_ascii=False, indent=2)

    # כתוב workspaces.json
    _save_workspaces_index([{"id": DEFAULT_WORKSPACE_ID, "name": "ברירת מחדל"}])


def list_workspaces() -> list[dict]:
    """מחזיר רשימת workspaces. מבצע migration אוטומטי אם עדיין לא נעשה."""
    if not WORKSPACES_INDEX.exists():
        _migrate_legacy_data()
    with open(WORKSPACES_INDEX, "r", encoding="utf-8") as f:
        return json.load(f)


def create_workspace(name: str, description: str = "") -> dict:
    ws_id = f"ws-{uuid.uuid4().hex[:8]}"
    ws_dir = _ws_dir(ws_id)

    meta = {
        "id": ws_id,
        "name": name,
        "description": description,
        "created_at": datetime.now().isoformat(),
        "style_defaults": {},
    }
    with open(ws_dir / "workspace.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    # אינדקס רפרנסים ריק
    refs_dir = ws_dir / "references"
    refs_dir.mkdir(parents=True, exist_ok=True)
    with open(refs_dir / "index.json", "w", encoding="utf-8") as f:
        json.dump({"base_dir": f"data/workspaces/{ws_id}/images", "references": []}, f, ensure_ascii=False, indent=2)

    # הוסף לאינדקס
    workspaces = list_workspaces()
    workspaces.append({"id": ws_id, "name": name})
    _save_workspaces_index(workspaces)

    return meta


def get_workspace(ws_id: str) -> dict:
    path = WORKSPACES_DIR / ws_id / "workspace.json"
    if not path.exists():
        raise FileNotFoundError(f"Workspace '{ws_id}' לא נמצא")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def update_workspace(ws_id: str, name: str | None = None, description: str | None = None) -> dict:
    meta = get_workspace(ws_id)
    if name is not None:
        meta["name"] = name
    if description is not None:
        meta["description"] = description
    with open(WORKSPACES_DIR / ws_id / "workspace.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    # עדכן גם באינדקס
    workspaces = list_workspaces()
    for ws in workspaces:
        if ws["id"] == ws_id:
            ws["name"] = meta["name"]
            break
    _save_workspaces_index(workspaces)
    return meta


def delete_workspace(ws_id: str) -> None:
    if ws_id == DEFAULT_WORKSPACE_ID:
        raise ValueError("לא ניתן למחוק את ה-workspace הראשי")
    ws_dir = WORKSPACES_DIR / ws_id
    if ws_dir.exists():
        shutil.rmtree(str(ws_dir))
    workspaces = list_workspaces()
    workspaces = [ws for ws in workspaces if ws["id"] != ws_id]
    _save_workspaces_index(workspaces)


# ---------- Project helpers ----------

def mishna_id_for(mp3_path: Path) -> str:
    rel = mp3_path.relative_to(PODCASTS_DIR).with_suffix("")
    return _slugify("__".join(rel.parts))


def discover_mishnayot(ws_id: str) -> list[dict]:
    """סורק את data/podcasts וגם את studio של ה-workspace ומחזיר רשימת משניות."""
    # ודא migration
    list_workspaces()

    results: list[dict] = []
    seen_ids = set()
    ws_studio = _ws_studio_dir(ws_id)

    # 1. סריקת Podcasts
    if PODCASTS_DIR.exists():
        for mp3 in sorted(PODCASTS_DIR.rglob("*.mp3")):
            srt = mp3.with_suffix(".srt")
            mid = mishna_id_for(mp3)
            seen_ids.add(mid)
            results.append({
                "mishna_id": mid,
                "title": mp3.stem,
                "rel_path": str(mp3.relative_to(ROOT)).replace("\\", "/"),
                "has_srt": srt.exists(),
                "has_project": (ws_studio / mid / "project.json").exists(),
                "mode": "studio",
            })

    # 2. סריקת studio של ה-workspace
    if ws_studio.exists():
        for p_dir in ws_studio.iterdir():
            if not p_dir.is_dir():
                continue
            mid = p_dir.name
            if mid in seen_ids:
                continue
            project_file = p_dir / "project.json"
            if project_file.exists():
                try:
                    with open(project_file, "r", encoding="utf-8") as f:
                        project_data = json.load(f)
                    results.append({
                        "mishna_id": mid,
                        "title": project_data.get("title", mid),
                        "rel_path": project_data.get("audio_path", ""),
                        "has_srt": bool(project_data.get("srt_path")),
                        "has_project": True,
                        "mode": project_data.get("mode", "studio"),
                    })
                    seen_ids.add(mid)
                except Exception:
                    continue

    return results


def _find_mp3_by_id(mishna_id: str) -> Path | None:
    for mp3 in PODCASTS_DIR.rglob("*.mp3"):
        if mishna_id_for(mp3) == mishna_id:
            return mp3
    return None


def _create_minute_slots(total_duration: float, images_per_minute, srt_path: str = None) -> list[dict]:
    """יוצר משבצת אחת לכל דקה עם sub-slots (סצנות) ריקים."""
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

        scenes = []
        for scene_idx in range(ipm):
            scenes.append({
                "scene_id": f"scene-{scene_idx + 1}",
                "start": "",
                "end": "",
                "mishna_text": "",
                "prompt": "",
                "references": [],
                "duration": 0.0,
                "location": "",
                "effect": "ken_burns",
                "intensity": "medium",
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


def studio_dir(mishna_id: str, ws_id: str = DEFAULT_WORKSPACE_ID) -> Path:
    d = _ws_studio_dir(ws_id) / mishna_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def project_path(mishna_id: str, ws_id: str = DEFAULT_WORKSPACE_ID) -> Path:
    return studio_dir(mishna_id, ws_id) / "project.json"


def load_or_init_project(mishna_id: str, ws_id: str = DEFAULT_WORKSPACE_ID) -> dict:
    """טוען project.json קיים, או יוצר שלד ריק מ-SRT."""
    # ודא migration
    list_workspaces()

    p = project_path(mishna_id, ws_id)
    if p.exists():
        with open(p, "r", encoding="utf-8") as f:
            project = json.load(f)

        # ודא שיש ws_id בפרויקט
        if "ws_id" not in project:
            project["ws_id"] = ws_id

        changed = False
        if not project.get("style_description"):
            project["style_description"] = DEFAULT_STYLE_DESCRIPTION
            changed = True
        if not project.get("style_references"):
            refs = load_references(ws_id)
            default_ref_id = None
            for r in refs.get("references", []):
                if r.get("file") == DEFAULT_STYLE_REF_NAME or r.get("name") == DEFAULT_STYLE_REF_NAME:
                    default_ref_id = r["id"]
                    break
            if default_ref_id:
                project["style_references"] = [default_ref_id]
                changed = True

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
        slots = _create_minute_slots(duration, DEFAULT_IMAGES_PER_MINUTE)

    refs = load_references(ws_id)
    default_ref_id = None
    for r in refs.get("references", []):
        if r.get("file") == DEFAULT_STYLE_REF_NAME or r.get("name") == DEFAULT_STYLE_REF_NAME:
            default_ref_id = r["id"]
            break

    project = {
        "mishna_id": mishna_id,
        "ws_id": ws_id,
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
    ws_id = project.get("ws_id", DEFAULT_WORKSPACE_ID)
    p = project_path(project["mishna_id"], ws_id)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(project, f, ensure_ascii=False, indent=2)


def create_custom_project(mishna_id: str, plot: str, srt_text: str, images_per_minute: int,
                          ws_id: str = DEFAULT_WORKSPACE_ID) -> dict:
    d = studio_dir(mishna_id, ws_id)
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

    refs = load_references(ws_id)
    default_ref_id = None
    for r in refs.get("references", []):
        if r.get("file") == DEFAULT_STYLE_REF_NAME or r.get("name") == DEFAULT_STYLE_REF_NAME:
            default_ref_id = r["id"]
            break

    project = {
        "mishna_id": mishna_id,
        "ws_id": ws_id,
        "title": mishna_id,
        "audio_path": "",
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


COMIC_SLOT_ID = "comic-slot"


def create_comics_project(mishna_id: str, title: str, description: str,
                          panels_target: int = 6, style_description: str = "",
                          pages_target: int | None = None,
                          ws_id: str = DEFAULT_WORKSPACE_ID) -> dict:
    """יוצר פרויקט קומיקס חדש (mode='comics')."""
    d = studio_dir(mishna_id, ws_id)
    if (d / "project.json").exists():
        raise ValueError(f"כבר קיים פרויקט עם המזהה '{mishna_id}'.")

    refs = load_references(ws_id)
    default_ref_id = None
    for r in refs.get("references", []):
        if r.get("file") == DEFAULT_STYLE_REF_NAME or r.get("name") == DEFAULT_STYLE_REF_NAME:
            default_ref_id = r["id"]
            break

    project = {
        "mishna_id": mishna_id,
        "ws_id": ws_id,
        "title": title or mishna_id,
        "mode": "comics",
        "description": description,
        "panels_target": panels_target,
        "pages_target": pages_target,
        "director_instructions": "",
        "style_description": style_description or DEFAULT_STYLE_DESCRIPTION,
        "style_references": [default_ref_id] if default_ref_id else [],
        "slots": [{"id": COMIC_SLOT_ID, "scenes": [], "status": "proposed"}],
    }
    save_project(project)
    return project


def get_slot(project: dict, slot_id: str) -> dict | None:
    for s in project.get("slots", []):
        if s.get("id") == slot_id:
            return s
    return None


# ---------- References ----------

def load_references(ws_id: str = DEFAULT_WORKSPACE_ID) -> dict:
    # ודא migration
    list_workspaces()
    idx = _ws_references_index(ws_id)
    if not idx.exists():
        return {"base_dir": f"data/workspaces/{ws_id}/images", "references": []}
    with open(idx, "r", encoding="utf-8") as f:
        return json.load(f)


def _save_references(ws_id: str, refs: dict) -> None:
    idx = _ws_references_index(ws_id)
    idx.parent.mkdir(parents=True, exist_ok=True)
    with open(idx, "w", encoding="utf-8") as f:
        json.dump(refs, f, ensure_ascii=False, indent=2)


def reference_meta(ref_value: str, version_index: int = -1, project: dict | None = None) -> dict | None:
    ws_id = (project or {}).get("ws_id", DEFAULT_WORKSPACE_ID)
    path = reference_file_path(ref_value, version_index=version_index, project=project)
    if path is None:
        return None

    if ref_value.startswith("scene:"):
        return {"path": path, "name": "הסצנה הקודמת", "description": "", "category": "scene"}

    id_to_find = ref_value
    name_to_find = None
    if "|" in ref_value:
        parts = [p.strip() for p in ref_value.split("|")]
        id_to_find = parts[0]
        if len(parts) > 1:
            name_to_find = parts[1]

    refs = load_references(ws_id)
    for r in refs.get("references", []):
        rid, rname, rfile = r.get("id"), r.get("name"), r.get("file")
        match = (id_to_find in (rid, rname, rfile))
        if not match and name_to_find:
            match = (name_to_find in (rid, rname, rfile))
        if match:
            meta = {
                "path": path,
                "name": r.get("name", "") or "",
                "description": r.get("description", "") or "",
                "category": r.get("category", "") or "",
            }
            sheet_file = r.get("sheet_file")
            if sheet_file:
                base = ROOT / refs.get("base_dir", f"data/workspaces/{ws_id}/images")
                sheet_path = base / sheet_file
                if sheet_path.exists():
                    meta["sheet_path"] = sheet_path
            return meta

    return {"path": path, "name": name_to_find or id_to_find or path.stem, "description": "", "category": ""}


def reference_file_path(ref_value: str, version_index: int = -1, project: dict | None = None) -> Path | None:
    if not ref_value:
        return None

    ws_id = (project or {}).get("ws_id", DEFAULT_WORKSPACE_ID)

    if ref_value.startswith("scene:") and project:
        parts = ref_value.split(":")
        target_scene = None
        if len(parts) == 3:
            m_id, s_id = parts[1], parts[2]
            slot = get_slot(project, m_id)
            if slot:
                target_scene = next((s for s in slot.get("scenes", []) if s["scene_id"] == s_id), None)
        if target_scene and target_scene.get("image_path"):
            return studio_dir(project["mishna_id"], ws_id) / target_scene["image_path"]
        return None

    id_to_find = ref_value
    name_to_find = None
    if "|" in ref_value:
        parts = [p.strip() for p in ref_value.split("|")]
        id_to_find = parts[0]
        if len(parts) > 1:
            name_to_find = parts[1]

    print(f"[Reference] Searching for: '{ref_value}' (ID: '{id_to_find}', Name: '{name_to_find}')")

    refs = load_references(ws_id)
    base = ROOT / refs.get("base_dir", f"data/workspaces/{ws_id}/images")

    for r in refs.get("references", []):
        rid = r.get("id")
        rname = r.get("name")
        rfile = r.get("file")

        match = (id_to_find == rid or id_to_find == rname or id_to_find == rfile)
        if not match and name_to_find:
            match = (name_to_find == rid or name_to_find == rname or name_to_find == rfile)

        if match:
            print(f"[Reference] Found match! ID: {rid}, Name: {rname}, File: {rfile}")
            if version_index >= 0 and r.get("versions") and version_index < len(r["versions"]):
                return base / r["versions"][version_index]["file"]
            return base / r["file"]

    print(f"[Reference] No match found in index for '{ref_value}'")
    candidate = base / ref_value
    if candidate.exists():
        print(f"[Reference] Found as direct file: {candidate}")
        return candidate

    return None


def reference_sheet_path(ref_value: str, project: dict | None = None) -> Path | None:
    if not ref_value or ref_value.startswith("scene:"):
        return None

    ws_id = (project or {}).get("ws_id", DEFAULT_WORKSPACE_ID)
    id_to_find = ref_value
    name_to_find = None
    if "|" in ref_value:
        parts = [p.strip() for p in ref_value.split("|")]
        id_to_find = parts[0]
        if len(parts) > 1:
            name_to_find = parts[1]

    refs = load_references(ws_id)
    base = ROOT / refs.get("base_dir", f"data/workspaces/{ws_id}/images")
    for r in refs.get("references", []):
        rid, rname, rfile = r.get("id"), r.get("name"), r.get("file")
        match = (id_to_find in (rid, rname, rfile))
        if not match and name_to_find:
            match = (name_to_find in (rid, rname, rfile))
        if match:
            sheet_file = r.get("sheet_file")
            if sheet_file:
                p = base / sheet_file
                return p if p.exists() else None
            return None
    return None


def add_reference(filename: str, content: bytes, name: str, description: str, category: str,
                  sheet_file: str | None = None, ws_id: str = DEFAULT_WORKSPACE_ID) -> dict:
    refs = load_references(ws_id)

    for r in refs.get("references", []):
        if r.get("name") == name:
            raise ValueError(f"כבר קיים רפרנס עם השם '{name}'. נא לבחור שם ייחודי.")

    base = _ws_images_dir(ws_id)
    file_path = base / filename
    with open(file_path, "wb") as f:
        f.write(content)

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
        "versions": [],
        "sheet_file": sheet_file,
    }

    refs.setdefault("references", []).append(new_ref)
    refs["base_dir"] = f"data/workspaces/{ws_id}/images"
    _save_references(ws_id, refs)

    return new_ref


# שמירת STUDIO_DIR ו-REFERENCES_INDEX כאלייסים לתאימות לאחור עם קוד שעוד משתמש בהם
STUDIO_DIR = _LEGACY_STUDIO_DIR
REFERENCES_INDEX = _LEGACY_REFERENCES_INDEX
