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
class CreateProjectBody(BaseModel):
    mishna_id: str
    plot: str
    srt_text: str
    images_per_minute: int = 4

class ProposeBody(BaseModel):
    images_per_minute: float | None = None
    plot: str | None = None
    director_instructions: str | None = None
    style_description: str | None = None
    style_references: list[str] | None = None
    custom_prompt: str | None = None


class SlotUpdate(BaseModel):
    text: str | None = None
    mishna_text: str | None = None
    prompt: str | None = None
    references: list[str] | None = None
    duration: float | None = None
    type: str | None = None
    status: str | None = None
    start: str | None = None
    end: str | None = None

# ---------- עזרי קבצים ----------
class RepromptBody(BaseModel):
    instruction: str | None = None

class GenerateWithPromptBody(BaseModel):
    prompt: str | None = None
    is_full_prompt: bool = False

def _get_previous_scene(project: dict, current_minute_id: str, current_scene_id: str):
    """מוצא את הסצנה הקודמת בפרויקט."""
    prev_scene = None
    for slot in project.get("slots", []):
        for s in slot.get("scenes", []):
            if slot["id"] == current_minute_id and s["scene_id"] == current_scene_id:
                return prev_scene
            prev_scene = s
    return None

@app.post("/api/project/{mishna_id}/minute/{minute_id}/scene/{scene_id}/generate")
def generate_scene(mishna_id: str, minute_id: str, scene_id: str, body: GenerateWithPromptBody | None = None):
    project = project_store.load_or_init_project(mishna_id)
    minute_slot = project_store.get_slot(project, minute_id)
    if minute_slot is None:
        raise HTTPException(status_code=404, detail="משבצת דקה לא נמצאה")
    
    scene = next((s for s in minute_slot.get("scenes", []) if s["scene_id"] == scene_id), None)
    if scene is None:
        raise HTTPException(status_code=404, detail="סצנה לא נמצאה")

    # התנהגות ברירת מחדל: אם אין רפרנסים, נסה להשתמש בסצנה קודמת
    refs_to_use = list(scene.get("references", []))
    if not refs_to_use:
        refs_to_use = ["scene:previous"]

    ref_paths = []
    for r in refs_to_use:
        if r == "scene:previous":
            prev = _get_previous_scene(project, minute_id, scene_id)
            if prev and prev.get("image_path"):
                p = project_store.studio_dir(mishna_id) / prev["image_path"]
                if p.exists():
                    ref_paths.append(p)
        else:
            p = project_store.reference_file_path(r, project=project)
            if p:
                ref_paths.append(p)

    out = project_store.studio_dir(mishna_id) / f"{minute_id}_{scene_id}.png"
    try:
        if body and body.is_full_prompt and body.prompt:
            # שימוש בפרומפט מלא כפי שהמשתמש ערך, מבלי להרכיב אותו מחדש
            gemini_images.generate_image(body.prompt, ref_paths, out, scene_type="character", is_full_prompt=True)
            # מעדכנים את הפרומפט בסצנה שיהיה הפרומפט החדש
            scene["prompt"] = body.prompt
        else:
            gemini_images.generate_image(scene.get("prompt", ""), ref_paths, out)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"שגיאת Gemini: {e}")

    scene["image_path"] = out.name
    scene["status"] = "image_ready"
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
    
    for field in ("mishna_text", "prompt", "references", "duration", "status", "start", "end"):
        val = getattr(body, field, None)
        if val is not None:
            scene[field] = val
    
    # חישוב duration לסצנה הנוכחית אם הזמנים השתנו
    from .srt_parser import timestamp_to_seconds, seconds_to_timestamp
    if scene.get("start") and scene.get("end"):
        s_sec = timestamp_to_seconds(scene["start"])
        e_sec = timestamp_to_seconds(scene["end"])
        scene["duration"] = max(0, e_sec - s_sec)
            
    # Ripple Edit בשרת - עדכון זמנים של כל הסצנות שאחרי
    if body.end is not None:
        try:
            current_start = timestamp_to_seconds(body.end)
            found = False
            for s in minute_slot.get("scenes", []):
                if found:
                    s_sec = timestamp_to_seconds(s.get("start", "00:00:00.000"))
                    e_sec = timestamp_to_seconds(s.get("end", "00:00:00.000"))
                    duration = e_sec - s_sec
                    if duration < 0: duration = 0
                    
                    s["start"] = seconds_to_timestamp(current_start)
                    s["end"] = seconds_to_timestamp(current_start + duration)
                    s["duration"] = duration
                    current_start += duration
                if s["scene_id"] == scene_id:
                    found = True
        except Exception as e:
            print(f"Error in Ripple Edit: {e}")
            
    project_store.save_project(project)
    return scene

@app.post("/api/project/{mishna_id}/minute/{minute_id}/scene/{scene_id}/add-{position}")
def add_scene(mishna_id: str, minute_id: str, scene_id: str, position: str):
    if position not in ("before", "after"):
        raise HTTPException(status_code=400, detail="Position must be 'before' or 'after'")
        
    project = project_store.load_or_init_project(mishna_id)
    minute_slot = project_store.get_slot(project, minute_id)
    if minute_slot is None:
        raise HTTPException(status_code=404, detail="משבצת דקה לא נמצאה")
        
    scenes = minute_slot.get("scenes", [])
    idx = next((i for i, s in enumerate(scenes) if s["scene_id"] == scene_id), -1)
    
    if idx == -1:
        raise HTTPException(status_code=404, detail="סצנה לא נמצאה")
        
    import uuid
    new_scene_id = f"scene-custom-{uuid.uuid4().hex[:6]}"
    
    target_scene = scenes[idx]
    
    # חלוקת הזמן של הסצנה הנוכחית לחצי
    from .srt_parser import timestamp_to_seconds, seconds_to_timestamp
    start_sec = timestamp_to_seconds(target_scene.get("start", "00:00:00.000"))
    end_sec = timestamp_to_seconds(target_scene.get("end", "00:00:02.000"))
    mid_sec = start_sec + (end_sec - start_sec) / 2
    
    new_scene = {
        "scene_id": new_scene_id,
        "mishna_text": "",
        "prompt": "סצנה חדשה - יש לערוך",
        "references": [],
        "image_path": None,
        "status": "proposed"
    }
    
    if position == "before":
        new_scene["start"] = seconds_to_timestamp(start_sec)
        new_scene["end"] = seconds_to_timestamp(mid_sec)
        target_scene["start"] = seconds_to_timestamp(mid_sec)
        scenes.insert(idx, new_scene)
    else:
        target_scene["end"] = seconds_to_timestamp(mid_sec)
        new_scene["start"] = seconds_to_timestamp(mid_sec)
        new_scene["end"] = seconds_to_timestamp(end_sec)
        scenes.insert(idx + 1, new_scene)
        
    project_store.save_project(project)
    return {"status": "ok", "new_scene": new_scene}

class ReferenceUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    category: str | None = None
    age: str | None = None
    height: str | None = None
    items: list[str] | None = None
    dormant: bool | None = None


class RepromptBody(BaseModel):
    instruction: str | None = None


# ---------- עזרי קבצים ----------
def _abs(rel_path: str) -> Path:
    return (ROOT / rel_path).resolve()


from fastapi import UploadFile, Form

# ---------- API: גילוי וטעינה ----------
@app.get("/api/mishnayot")
def list_mishnayot():
    return project_store.discover_mishnayot()


@app.get("/api/references")
def get_references():
    return project_store.load_references()

@app.put("/api/references/{ref_id}")
def update_reference(ref_id: str, body: ReferenceUpdate):
    refs = project_store.load_references()
    found = False
    for r in refs.get("references", []):
        if r["id"] == ref_id:
            for field, val in body.dict(exclude_unset=True).items():
                r[field] = val
            found = True
            break
    if not found:
        raise HTTPException(status_code=404, detail="רפרנס לא נמצא")
    
    with open(project_store.REFERENCES_INDEX, "w", encoding="utf-8") as f:
        json.dump(refs, f, ensure_ascii=False, indent=2)
    return {"status": "ok"}

@app.post("/api/references")
async def add_reference(
    file: UploadFile,
    name: str = Form(...),
    description: str = Form(...),
    category: str = Form(...)
):
    try:
        content = await file.read()
        return project_store.add_reference(file.filename, content, name, description, category)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/references/{ref_id}/image")
async def upload_reference_image(ref_id: str, file: UploadFile):
    refs = project_store.load_references()
    found_ref = None
    for r in refs.get("references", []):
        if r["id"] == ref_id:
            found_ref = r
            break
    
    if not found_ref:
        raise HTTPException(status_code=404, detail="Reference not found")
        
    try:
        content = await file.read()
        base = project_store.ROOT / refs.get("base_dir", "data/images")
        
        # Save new image and move old to versions if not already there
        import uuid
        import datetime
        
        new_filename = f"ref_{uuid.uuid4().hex[:8]}_{file.filename}"
        with open(base / new_filename, "wb") as f:
            f.write(content)
            
        # Add current to versions
        if "versions" not in found_ref:
            found_ref["versions"] = []
            
        found_ref["versions"].append({
            "file": found_ref["file"],
            "timestamp": datetime.datetime.now().isoformat()
        })
        
        found_ref["file"] = new_filename
        
        with open(project_store.REFERENCES_INDEX, "w", encoding="utf-8") as f:
            json.dump(refs, f, ensure_ascii=False, indent=2)
            
        return found_ref
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/references/{ref_id}/v2")
async def generate_reference_v2(ref_id: str, mishna_id: str):
    refs = project_store.load_references()
    found_ref = None
    for r in refs.get("references", []):
        if r["id"] == ref_id:
            found_ref = r
            break
    
    if not found_ref:
        raise HTTPException(status_code=404, detail="Reference not found")
        
    project = project_store.load_or_init_project(mishna_id)
    style_desc = project.get("style_description", "")
    style_refs = project.get("style_references", [])
    
    # Use current image as a reference for V2
    current_ref_path = project_store.reference_file_path(ref_id)
    ref_paths = [current_ref_path] if current_ref_path else []
    
    # Add style references
    for s_id in style_refs:
        p = project_store.reference_file_path(s_id)
        if p:
            ref_paths.append(p)
            
    full_prompt = found_ref["description"]
    if style_desc:
        full_prompt = f"Style: {style_desc}\n\nSubject: {found_ref['description']}. This is a second version (V2) of the character, keep the same features but in a slightly different pose or lighting."

    import uuid
    import datetime
    filename = f"ref_v2_{uuid.uuid4().hex[:8]}.png"
    out = project_store.ROOT / "data" / "images" / filename
    
    try:
        gemini_images.generate_image(full_prompt, ref_paths, out)
        
        # Add current to versions
        if "versions" not in found_ref:
            found_ref["versions"] = []
            
        found_ref["versions"].append({
            "file": found_ref["file"],
            "timestamp": datetime.datetime.now().isoformat()
        })
        
        found_ref["file"] = filename
        
        with open(project_store.REFERENCES_INDEX, "w", encoding="utf-8") as f:
            json.dump(refs, f, ensure_ascii=False, indent=2)
            
        return found_ref
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Gemini error: {e}")


@app.post("/api/project/create")
def create_project(body: CreateProjectBody):
    try:
        return project_store.create_custom_project(
            body.mishna_id, body.plot, body.srt_text, body.images_per_minute
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/project/{mishna_id}/prompt-preview")
def get_prompt_preview(mishna_id: str):
    project = project_store.load_or_init_project(mishna_id)
    if not project.get("srt_path"):
        raise HTTPException(status_code=400, detail="אין קובץ SRT למשנה זו")
        
    refs = project_store.load_references()
    plot_path = project.get("plot_path")
    
    try:
        plot_abs = str(_abs(plot_path)) if plot_path else None
        
        prompt_text = claude_brain.preview_prompt(
            srt_path=str(_abs(project["srt_path"])),
            images_per_minute=project.get("images_per_minute", 4),
            references=refs,
            plot_path=plot_abs,
            director_instructions=project.get("director_instructions", ""),
            style_description=project.get("style_description", "")
        )
        return {"prompt": prompt_text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/project/{mishna_id}")
def get_project(mishna_id: str):
    try:
        return project_store.load_or_init_project(mishna_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ---------- API: הצעת Claude ----------
@app.post("/api/project/{mishna_id}/propose-stream")
def propose_stream(mishna_id: str, body: ProposeBody):
    """מציע משבצות לכל הפרויקט."""
    project = project_store.load_or_init_project(mishna_id)
    if not project.get("srt_path"):
        raise HTTPException(status_code=400, detail="אין קובץ SRT למשנה זו")
    if body.images_per_minute is not None:
        project["images_per_minute"] = body.images_per_minute
        project_store.save_project(project)

    refs = project_store.load_references()
    
    try:
        plot_path = project.get("plot_path")
        director_instructions = project.get("director_instructions", "")
        style_description = project.get("style_description", "")
        updated_slots = claude_brain.propose_slots(
            srt_path=str(_abs(project["srt_path"])),
            images_per_minute=project.get("images_per_minute", 4),
            references=refs,
            existing_slots=project.get("slots"),
            plot_path=plot_path,
            director_instructions=director_instructions,
            style_description=style_description,
            custom_prompt=body.custom_prompt
        )
        project["slots"] = updated_slots
        project_store.save_project(project)
        
        def generate_events():
            for slot in updated_slots:
                yield json.dumps({"type": "minute", "minute": slot}, ensure_ascii=False) + "\n"
            yield json.dumps({"type": "done"}, ensure_ascii=False) + "\n"
        
        return StreamingResponse(generate_events(), media_type="application/x-ndjson")
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"שגיאת Claude: {type(e).__name__}: {e}")


@app.post("/api/project/{mishna_id}/minute/{minute_id}/scene/{scene_id}/repropose")
def repropose_scene(mishna_id: str, minute_id: str, scene_id: str, body: RepromptBody):
    project = project_store.load_or_init_project(mishna_id)
    minute_slot = project_store.get_slot(project, minute_id)
    if minute_slot is None:
        raise HTTPException(status_code=404, detail="משבצת דקה לא נמצאה")
    
    scene = next((s for s in minute_slot.get("scenes", []) if s["scene_id"] == scene_id), None)
    if scene is None:
        raise HTTPException(status_code=404, detail="סצנה לא נמצאה")
        
    refs = project_store.load_references()
    try:
        scene_context = {
            "start": scene.get("start"),
            "end": scene.get("end"),
            "text": minute_slot.get("text", "") + "\n(Mishna: " + scene.get("mishna_text", "") + ")",
            "prompt": scene.get("prompt", "")
        }
        result = claude_brain.repropose_prompt(scene_context, refs, body.instruction)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"שגיאת Claude: {e}")
        
    scene["prompt"] = result["prompt"]
    if result["references"]:
        scene["references"] = result["references"]
    scene["status"] = "proposed"
    project_store.save_project(project)
    return scene


# ---------- API: עריכת במאי ----------
@app.put("/api/project/{mishna_id}/slot/{slot_id}")
def update_slot(mishna_id: str, slot_id: str, body: SlotUpdate):
    project = project_store.load_or_init_project(mishna_id)
    slot = project_store.get_slot(project, slot_id)
    if slot is None:
        raise HTTPException(status_code=404, detail="משבצת לא נמצאה")
    for field in ("text", "mishna_text", "prompt", "references", "duration", "type", "status"):
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
    if body.director_instructions is not None:
        project["director_instructions"] = body.director_instructions
    if body.style_description is not None:
        project["style_description"] = body.style_description
    if body.style_references is not None:
        project["style_references"] = body.style_references
    project_store.save_project(project)
    return project


# ---------- API: יצירת תמונות ואישור ----------


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


@app.get("/api/project/{mishna_id}/minute/{minute_id}/scene/{scene_id}/gemini-prompt")
def get_scene_gemini_prompt(mishna_id: str, minute_id: str, scene_id: str):
    project = project_store.load_or_init_project(mishna_id)
    minute_slot = project_store.get_slot(project, minute_id)
    if minute_slot is None:
        raise HTTPException(status_code=404, detail="משבצת דקה לא נמצאה")
    
    scene = next((s for s in minute_slot.get("scenes", []) if s["scene_id"] == scene_id), None)
    if scene is None:
        raise HTTPException(status_code=404, detail="סצנה לא נמצאה")

    refs_to_use = list(scene.get("references", []))
    if not refs_to_use:
        refs_to_use = ["scene:previous"]

    ref_paths = []
    for r in refs_to_use:
        if r == "scene:previous":
            prev = _get_previous_scene(project, minute_id, scene_id)
            if prev and prev.get("image_path"):
                p = project_store.studio_dir(mishna_id) / prev["image_path"]
                if p.exists():
                    ref_paths.append(p)
        else:
            p = project_store.reference_file_path(r, project=project)
            if p:
                ref_paths.append(p)

    full_prompt = gemini_images.get_full_prompt(scene.get("prompt", ""), ref_paths)
    return {"full_prompt": full_prompt}




# ---------- API: מדיה ----------
@app.get("/api/project/{mishna_id}/audio")
def get_audio(mishna_id: str):
    project = project_store.load_or_init_project(mishna_id)
    if not project.get("audio_path"):
        raise HTTPException(status_code=404, detail="קובץ אודיו לא נמצא")
    audio = _abs(project["audio_path"])
    if not audio.exists():
        raise HTTPException(status_code=404, detail="קובץ אודיו לא נמצא")
    return FileResponse(str(audio), media_type="audio/mpeg")

@app.post("/api/project/{mishna_id}/audio")
async def upload_audio(mishna_id: str, file: UploadFile):
    project = project_store.load_or_init_project(mishna_id)
    d = project_store.studio_dir(mishna_id)
    audio_path = d / file.filename
    content = await file.read()
    with open(audio_path, "wb") as f:
        f.write(content)
    
    project["audio_path"] = str(audio_path.relative_to(ROOT)).replace("\\", "/")
    project_store.save_project(project)
    return {"status": "ok", "audio_path": project["audio_path"]}


@app.post("/api/project/{mishna_id}/srt")
async def upload_srt(mishna_id: str, file: UploadFile):
    project = project_store.load_or_init_project(mishna_id)
    d = project_store.studio_dir(mishna_id)
    srt_path = d / file.filename
    content = await file.read()
    with open(srt_path, "wb") as f:
        f.write(content)
    
    project["srt_path"] = str(srt_path.relative_to(ROOT)).replace("\\", "/")
    
    # אם אין עדיין סצנות, ננסה ליצור אותן עכשיו כשיש SRT
    if not project.get("slots") and project.get("audio_duration") == 0:
        from .srt_parser import parse_srt, total_duration
        cues = parse_srt(str(srt_path))
        duration = total_duration(cues)
        project["audio_duration"] = duration
        project["slots"] = project_store._create_minute_slots(duration, project.get("images_per_minute", 4))
        
    project_store.save_project(project)
    return {"status": "ok", "srt_path": project["srt_path"]}


@app.get("/api/project/{mishna_id}/srt-content")
def get_srt_content(mishna_id: str):
    project = project_store.load_or_init_project(mishna_id)
    srt_path = project.get("srt_path")
    if not srt_path:
        raise HTTPException(status_code=404, detail="No SRT file for this project")
    
    p = _abs(srt_path)
    if not p.exists():
        raise HTTPException(status_code=404, detail="SRT file not found")
        
    with open(p, "r", encoding="utf-8") as f:
        return {"content": f.read()}


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


@app.post("/api/project/{mishna_id}/create-reference-image")
async def create_reference_image(mishna_id: str, body: ReferenceUpdate):
    if not body.description:
        raise HTTPException(status_code=400, detail="Description is required")
    
    project = project_store.load_or_init_project(mishna_id)
    style_desc = project.get("style_description", "")
    style_refs = project.get("style_references", [])
    
    # בניית פרומפט משולב עם הסגנון
    full_prompt = body.description
    if style_desc:
        full_prompt = f"Style: {style_desc}\n\nSubject: {body.description}"
    
    # איסוף נתיבי תמונות האווירה
    ref_paths = []
    for r_id in style_refs:
        p = project_store.reference_file_path(r_id)
        if p:
            ref_paths.append(p)

    # Generate image for reference
    import uuid
    filename = f"ref_{uuid.uuid4().hex[:8]}.png"
    out = project_store.ROOT / "data" / "images" / filename
    
    try:
        gemini_images.generate_image(full_prompt, ref_paths, out)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Gemini error: {e}")
        
    # Add to global references
    with open(out, "rb") as f:
        content = f.read()
        
    new_ref = project_store.add_reference(
        filename, content, body.name or "New Reference", body.description, body.category or "characters"
    )
    
    # Update extra fields
    refs = project_store.load_references()
    for r in refs.get("references", []):
        if r["id"] == new_ref["id"]:
            r["age"] = body.age
            r["height"] = body.height
            break
            
    with open(project_store.REFERENCES_INDEX, "w", encoding="utf-8") as f:
        json.dump(refs, f, ensure_ascii=False, indent=2)
        
    return new_ref


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
    if not project.get("audio_path"):
        raise HTTPException(status_code=400, detail="חסר קובץ אודיו להרכבת הוידאו")
    
    audio = _abs(project["audio_path"])
    out = project_store.studio_dir(mishna_id) / "output.mp4"
    
    def generate_build_logs():
        try:
            for line in video_builder.build_video_stream(project, audio, out):
                yield line
        except Exception as e:
            yield f"CRITICAL ERROR: {str(e)}\n"

    return StreamingResponse(generate_build_logs(), media_type="text/plain")


@app.get("/api/project/{mishna_id}/video")
def get_video(mishna_id: str):
    out = project_store.studio_dir(mishna_id) / "output.mp4"
    if not out.exists():
        raise HTTPException(status_code=404, detail="עדיין לא הורכב וידאו")
    return FileResponse(str(out), media_type="video/mp4")


# ---------- הגשת קבצי דאטה ----------
data_dir = Path(__file__).resolve().parent.parent / "data"
if data_dir.exists():
    app.mount("/data", StaticFiles(directory=str(data_dir)), name="data")

# ---------- הגשת ה-UI הסטטי ----------
app.mount("/", StaticFiles(directory=str(Path(__file__).resolve().parent / "static"), html=True), name="static")
