"""יצירת תמונות ב-Gemini עם רפרנסים לעקביות דמויות (image-to-image).

מודל: ניתן להגדרה דרך GEMINI_IMAGE_MODEL (ברירת מחדל gemini-3-pro-image-preview, "Nano Banana Pro").
מפתח: GEMINI_API_KEY.
"""
from __future__ import annotations

import mimetypes
import os
from pathlib import Path

from google import genai
from google.genai import types

MODEL = os.environ.get("GEMINI_IMAGE_MODEL", "gemini-3-pro-image-preview")


def _client() -> genai.Client:
    """יוצר לקוח Gemini. משתמש ב-proxy רק אם מוגדר GEMINI_PROXY בסביבה."""
    proxy_url = os.environ.get("GEMINI_PROXY")
    
    if proxy_url:
        print(f"[Gemini] משתמש ב-proxy: {proxy_url}")
        os.environ["HTTP_PROXY"] = proxy_url
        os.environ["HTTPS_PROXY"] = proxy_url
    else:
        os.environ.pop("HTTP_PROXY", None)
        os.environ.pop("HTTPS_PROXY", None)
    
    return genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))


def _guess_mime(path: Path) -> str:
    mime, _ = mimetypes.guess_type(str(path))
    return mime or "image/png"


def _normalize_refs(references: list) -> list[tuple[Path, str | None]]:
    """מנרמל רשימת רפרנסים לצורת (path, label). תומך גם ב-Path וגם ב-dict{path,label}."""
    out: list[tuple[Path, str | None]] = []
    for item in references or []:
        if item is None:
            continue
        if isinstance(item, dict):
            p = item.get("path")
            label = item.get("label")
        else:
            p, label = item, None
        if p:
            out.append((Path(p), label))
    return out


def get_full_prompt(prompt: str, references: list, scene_type: str = "character", is_full_prompt: bool = False) -> str:
    """מחזיר את הטקסט המלא שיישלח ל-Gemini כהנחיה."""
    has_refs = bool(_normalize_refs(references))

    # פרומפט מלא: המשתמש ערך אותו ידנית — לא לעטוף בהנחיות נוספות.
    if is_full_prompt:
        return prompt

    refs_note = (
        " צורפו תמונות רפרנס מתויגות; השתמש בכל אחת אך ורק עבור הדמות/החפץ/המקום שצוין בתווית שלידה."
        if has_refs else ""
    )

    if scene_type == "object":
        instruction = (
            "השתמש בתמונות הרפרנס המצורפות אך ורק כדי לשמור על עקביות הסגנון האמנותי. "
            "התמקד אך ורק באובייקט המרכזי. שמור על רקע פשוט, נקי ולא עמוס, "
            "כיוון שאלמנט זה ישולב בסצנות אחרות. אל תכלול דמויות כלל." + refs_note +
            " צור איור יחיד עבור האובייקט הבא: " + prompt
        )
    elif scene_type == "place":
        instruction = (
            "השתמש בתמונות הרפרנס המצורפות אך ורק כדי לשמור על עקביות הסגנון האמנותי. "
            "התמקד בסביבה ובאווירה. אל תכלול דמויות אלא אם כן הן מוזכרות במפורש בפרומפט." + refs_note +
            " צור איור יחיד עבור המקום הבא: " + prompt
        )
    else:  # character
        instruction = prompt
        if has_refs:
            instruction = (
                "השתמש בתמונות הרפרנס המצורפות כדי לשמור על המראה של הדמויות "
                "ועל הסגנון הכללי." + refs_note +
                " צור איור יחיד עבור הסצנה הבאה: " + prompt
            )
    return instruction


def generate_image(prompt: str, references: list, out_path: Path, scene_type: str = "character", is_full_prompt: bool = False) -> Path:
    """יוצר תמונה אחת מ-prompt + תמונות רפרנס, שומר ל-out_path. מחזיר את הנתיב.

    references: רשימה של Path או של dict{path, label}. כשיש label, נשלחת תווית טקסט
    מיד לפני כל תמונה כדי ש-Gemini ידע איזו דמות/חפץ/מקום כל תמונה מייצגת.
    scene_type: "character", "place", or "object".
    """
    print(f"[Gemini] מתחיל יצירת תמונה עם מודל: {MODEL} (סוג: {scene_type})")

    refs = _normalize_refs(references)
    instruction = get_full_prompt(prompt, references, scene_type, is_full_prompt=is_full_prompt)

    print(f"[Gemini] prompt: {prompt[:100]}..." if len(prompt) > 100 else f"[Gemini] prompt: {prompt}")
    print(f"[Gemini] מספר רפרנסים: {len(refs)}")

    contents: list = []
    # לכל רפרנס: תווית טקסט (אם יש) ואז התמונה — כך Gemini יודע מי מי.
    for rp, label in refs:
        if rp and rp.exists():
            print(f"[Gemini] טוען רפרנס: {rp.name} ({label or 'ללא תווית'})")
            if label:
                contents.append(f"תמונת הרפרנס הבאה היא {label}. שמור על מראה זהה לחלוטין.")
            contents.append(
                types.Part.from_bytes(
                    data=rp.read_bytes(),
                    mime_type=_guess_mime(rp),
                )
            )

    contents.append(instruction)

    print(f"[Gemini] שולח בקשה ל-API...")
    try:
        client = _client()
        response = client.models.generate_content(model=MODEL, contents=contents)
        print(f"[Gemini] התקבלה תשובה מהשרת")
    except Exception as e:
        print(f"[Gemini ERROR] שגיאה בקריאה ל-API: {type(e).__name__}: {e}")
        raise

    image_bytes = _extract_image_bytes(response)
    if image_bytes is None:
        print(f"[Gemini ERROR] לא נמצאה תמונה בתשובה")
        print(f"[Gemini] raw response: {response}")
        raise RuntimeError("Gemini לא החזיר תמונה (ייתכן שהבקשה נחסמה או שהמודל שגוי)")

    print(f"[Gemini] נמצאה תמונה, גודל: {len(image_bytes)} bytes")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(image_bytes)
    print(f"[Gemini] התמונה נשמרה ב-{out_path}")
    return out_path


def refine_image(image_bytes: bytes, instruction: str, mime_type: str = "image/png") -> bytes:
    """שולח תמונת עמוד קיימת ל-Gemini עם הוראת שיפור, ומחזיר תמונה משופרת.

    משמש למצב 'שפר עמוד' של הקומיקס — Gemini משפר את שילוב הבועות/זנבות באיור.
    """
    print(f"[Gemini] refine: {instruction[:80]}...")
    contents = [
        instruction,
        types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
    ]
    try:
        client = _client()
        response = client.models.generate_content(model=MODEL, contents=contents)
    except Exception as e:
        print(f"[Gemini ERROR] refine נכשל: {type(e).__name__}: {e}")
        raise
    out = _extract_image_bytes(response)
    if out is None:
        print(f"[Gemini] raw response: {response}")
        raise RuntimeError("Gemini לא החזיר תמונה משופרת")
    print(f"[Gemini] תמונה משופרת התקבלה, גודל: {len(out)} bytes")
    return out


def _extract_image_bytes(response) -> bytes | None:
    candidates = getattr(response, "candidates", None) or []
    for cand in candidates:
        content = getattr(cand, "content", None)
        parts = getattr(content, "parts", None) or []
        for part in parts:
            inline = getattr(part, "inline_data", None)
            if inline is not None and getattr(inline, "data", None):
                return inline.data
    return None
