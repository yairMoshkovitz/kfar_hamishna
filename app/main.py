"""שרת ה-Studio: FastAPI שמשרת את ממשק הבמאי + API לכל שלבי הצינור.

הרצה:  uvicorn app.main:app --reload
ואז:  http://localhost:8000
"""
from __future__ import annotations

import json
import traceback
from pathlib import Path

from dotenv import load_dotenv

# טעינת .env לפני ייבוא מודולים שקוראים מפתחות
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import claude_brain, gemini_images, project_store, video_builder

ROOT = project_store.ROOT
app = FastAPI(title="כפר המשנה — Studio")


# ---------- מודלים לבקשות ----------
class ProposeBody(BaseModel):
    images_per_minute: float | None = None


class SlotUpdate(BaseModel):
    text: str | None = None
    mishna_text: str | None = None  # שדה חדש לטקסט המשנה המקורי
    prompt: str | None = None
    references: list[str] | None = None
    duration: float | None = None
    type: str | None = None


class RepromptBody(BaseModel):
    instruction: str | None = None


# ---------- עזרי קבצים ----------
def _abs(rel_path: str) -> Path:
    return (ROOT / rel_path).resolve()


# ---------- API: גילוי וטעינה ----------
@app.get("/api/mishnayot")
def list_mishnayot():
    return project_store.discover_mishnayot()


@app.get("/api/references")
def get_references():
    return project_store.load_references()


@app.get("/api/project/{mishna_id}")
def get_project(mishna_id: str):
    try:
        return project_store.load_or_init_project(mishna_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ---------- API: הצעת Claude ----------
@app.post("/api/project/{mishna_id}/propose")
def propose(mishna_id: str, body: ProposeBody):
    project = project_store.load_or_init_project(mishna_id)
    if not project.get("srt_path"):
        raise HTTPException(status_code=400, detail="אין קובץ SRT למשנה זו")
    if body.images_per_minute is not None:
        project["images_per_minute"] = body.images_per_minute

    refs = project_store.load_references()
    try:
        updated_slots = claude_brain.propose_slots(
            str(_abs(project["srt_path"])),
            project["images_per_minute"],
            refs,
            existing_slots=project.get("slots")
        )
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"שגיאת Claude: {type(e).__name__}: {e}")

    # עדכון המשבצות הקיימות עם המידע החדש מ-Claude
    if updated_slots:
        for existing in project.get("slots", []):
            for updated in updated_slots:
                if existing["id"] == updated["id"]:
                    existing["mishna_text"] = updated.get("mishna_text", "")
                    existing["prompt"] = updated.get("prompt", "")
                    existing["references"] = updated.get("references", [])
                    break

    project_store.save_project(project)
    return project



@app.post("/api/project/{mishna_id}/propose-stream")
def propose_stream(mishna_id: str, body: ProposeBody):
    """מציע משבצות דקה אחת-אחת ומזרים כל אחת ברגע שהיא מוכנה (NDJSON).

    כל שורה היא אובייקט JSON: {"type":"minute","minute":{...}} למשבצת דקה שהושלמה,
    {"type":"error","minute_id":...,"detail":...} לכשל, ו-{"type":"done"} בסיום.
    """
    project = project_store.load_or_init_project(mishna_id)
    if not project.get("srt_path"):
        raise HTTPException(status_code=400, detail="אין קובץ SRT למשנה זו")
    if body.images_per_minute is not None:
        project["images_per_minute"] = body.images_per_minute
        project_store.save_project(project)

    refs = project_store.load_references()
    
    # מריצים את Claude על כל המשבצות ביחד
    try:
        updated_slots = claude_brain.propose_slots(
            str(_abs(project["srt_path"])),
            project["images_per_minute"],
            refs,
            existing_slots=project.get("slots")
        )
        project["slots"] = updated_slots
        project_store.save_project(project)
        
        # מזרימים כל משבצת דקה שהושלמה
        def generate_events():
            for minute_slot in updated_slots:
                yield json.dumps({"type": "minute", "minute": minute_slot}, ensure_ascii=False) + "\n"
            yield json.dumps({"type": "done"}, ensure_ascii=False) + "\n"
        
        return StreamingResponse(generate_events(), media_type="application/x-ndjson")
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"שגיאת Claude: {type(e).__name__}: {e}")


@app.post("/api/project/{mishna_id}/slot/{slot_id}/repropose")
def repropose(mishna_id: str, slot_id: str, body: RepromptBody):
    project = project_store.load_or_init_project(mishna_id)
    slot = project_store.get_slot(project, slot_id)
    if slot is None:
        raise HTTPException(status_code=404, detail="משבצת לא נמצאה")
    refs = project_store.load_references()
    try:
        result = claude_brain.repropose_prompt(slot, refs, body.instruction)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"שגיאת Claude: {e}")
    slot["prompt"] = result["prompt"]
    if result["references"]:
        slot["references"] = result["references"]
    slot["status"] = "proposed"
    project_store.save_project(project)
    return slot


# ---------- API: עריכת במאי ----------
@app.put("/api/project/{mishna_id}/slot/{slot_id}")
def update_slot(mishna_id: str, slot_id: str, body: SlotUpdate):
    project = project_store.load_or_init_project(mishna_id)
    slot = project_store.get_slot(project, slot_id)
    if slot is None:
        raise HTTPException(status_code=404, detail="משבצת לא נמצאה")
    for field in ("text", "mishna_text", "prompt", "references", "duration", "type"):
        val = getattr(body, field)
        if val is not None:
            slot[field] = val
    project_store.save_project(project)
    return slot


@app.put("/api/project/{mishna_id}")
def update_project(mishna_id: str, body: ProposeBody):
    project = project_store.load_or_init_project(mishna_id)
    if body.images_per_minute is not None:
        project["images_per_minute"] = body.images_per_minute
    project_store.save_project(project)
    return project


# ---------- API: יצירת תמונות ואישור (לסצנות בתוך משבצת דקה) ----------
@app.post("/api/project/{mishna_id}/minute/{minute_id}/scene/{scene_id}/generate")
def generate_scene(mishna_id: str, minute_id: str, scene_id: str):
    project = project_store.load_or_init_project(mishna_id)
    minute_slot = project_store.get_slot(project, minute_id)
    if minute_slot is None:
        raise HTTPException(status_code=404, detail="משבצת דקה לא נמצאה")
    
    scene = next((s for s in minute_slot.get("scenes", []) if s["scene_id"] == scene_id), None)
    if scene is None:
        raise HTTPException(status_code=404, detail="סצנה לא נמצאה")

    ref_paths = []
    for r in scene.get("references", []):
        p = project_store.reference_file_path(r)
        if p:
            ref_paths.append(p)

    out = project_store.studio_dir(mishna_id) / f"{minute_id}_{scene_id}.png"
    try:
        gemini_images.generate_image(scene.get("prompt", ""), ref_paths, out)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"שגיאת Gemini: {e}")

    scene["image_path"] = out.name
    scene["status"] = "image_ready"
    project_store.save_project(project)
    return scene


@app.post("/api/project/{mishna_id}/minute/{minute_id}/scene/{scene_id}/approve")
def approve_scene(mishna_id: str, minute_id: str, scene_id: str):
    project = project_store.load_or_init_project(mishna_id)
    minute_slot = project_store.get_slot(project, minute_id)
    if minute_slot is None:
        raise HTTPException(status_code=404, detail="משבצת דקה לא נמצאה")
    
    scene = next((s for s in minute_slot.get("scenes", []) if s["scene_id"] == scene_id), None)
    if scene is None:
        raise HTTPException(status_code=404, detail="סצנה לא נמצאה")
    
    scene["status"] = "image_approved" if scene.get("image_path") else "approved"
    project_store.save_project(project)
    return scene


@app.put("/api/project/{mishna_id}/minute/{minute_id}/scene/{scene_id}")
def update_scene(mishna_id: str, minute_id: str, scene_id: str, body: SlotUpdate):
    project = project_store.load_or_init_project(mishna_id)
    minute_slot = project_store.get_slot(project, minute_id)
    if minute_slot is None:
        raise HTTPException(status_code=404, detail="משבצת דקה לא נמצאה")
    
    scene = next((s for s in minute_slot.get("scenes", []) if s["scene_id"] == scene_id), None)
    if scene is None:
        raise HTTPException(status_code=404, detail="סצנה לא נמצאה")
    
    for field in ("mishna_text", "prompt", "references", "duration"):
        val = getattr(body, field, None)
        if val is not None:
            scene[field] = val
    project_store.save_project(project)
    return scene


# ---------- API: מדיה ----------
@app.get("/api/project/{mishna_id}/audio")
def get_audio(mishna_id: str):
    project = project_store.load_or_init_project(mishna_id)
    audio = _abs(project["audio_path"])
    if not audio.exists():
        raise HTTPException(status_code=404, detail="קובץ אודיו לא נמצא")
    return FileResponse(str(audio), media_type="audio/mpeg")


@app.get("/api/project/{mishna_id}/minute/{minute_id}/scene/{scene_id}/image")
def get_scene_image(mishna_id: str, minute_id: str, scene_id: str):
    project = project_store.load_or_init_project(mishna_id)
    minute_slot = project_store.get_slot(project, minute_id)
    if minute_slot is None:
        raise HTTPException(status_code=404, detail="משבצת דקה לא נמצאה")
    
    scene = next((s for s in minute_slot.get("scenes", []) if s["scene_id"] == scene_id), None)
    if scene is None or not scene.get("image_path"):
        raise HTTPException(status_code=404, detail="אין תמונה לסצנה")
    
    img = project_store.studio_dir(mishna_id) / Path(scene["image_path"]).name
    if not img.exists():
        raise HTTPException(status_code=404, detail="קובץ התמונה לא נמצא")
    return FileResponse(str(img))


@app.get("/api/reference-image/{ref_id}")
def get_reference_image(ref_id: str):
    p = project_store.reference_file_path(ref_id)
    if not p or not p.exists():
        raise HTTPException(status_code=404, detail="רפרנס לא נמצא")
    return FileResponse(str(p))


# ---------- API: הרכבת וידאו ----------
@app.post("/api/project/{mishna_id}/build")
def build(mishna_id: str):
    project = project_store.load_or_init_project(mishna_id)
    audio = _abs(project["audio_path"])
    out = project_store.studio_dir(mishna_id) / "output.mp4"
    try:
        video_builder.build_video(project, audio, out)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"video_path": str(out.relative_to(ROOT)).replace("\\", "/"), "ok": True}


@app.get("/api/project/{mishna_id}/video")
def get_video(mishna_id: str):
    out = project_store.studio_dir(mishna_id) / "output.mp4"
    if not out.exists():
        raise HTTPException(status_code=404, detail="עדיין לא הורכב וידאו")
    return FileResponse(str(out), media_type="video/mp4")


# ---------- הגשת ה-UI הסטטי ----------
app.mount("/", StaticFiles(directory=str(Path(__file__).resolve().parent / "static"), html=True), name="static")
