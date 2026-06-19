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
    # ב-google-genai ה-Client לא מקבל http_client ישירות ב-Constructor.
    # אנחנו מגדירים את ה-proxy דרך משתני סביבה שהספרייה מכבדת (דרך httpx פנימי).
    proxy_url = os.environ.get("GEMINI_PROXY")
    
    if proxy_url:
        print(f"[Gemini] משתמש ב-proxy: {proxy_url}")
        os.environ["HTTP_PROXY"] = proxy_url
        os.environ["HTTPS_PROXY"] = proxy_url
    else:
        # ניקוי משתני סביבה של פרוקסי אם אינם מוגדרים (למקרה ששאריות נשארו)
        os.environ.pop("HTTP_PROXY", None)
        os.environ.pop("HTTPS_PROXY", None)
    
    # מכיוון שאי אפשר לבטל SSL VERIFY בקלות בתוך ה-SDK החדש,
    # נסתמך על זה שה-Proxy או השרת מטפלים בזה.
    return genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))


def _guess_mime(path: Path) -> str:
    mime, _ = mimetypes.guess_type(str(path))
    return mime or "image/png"


def generate_image(prompt: str, reference_paths: list[Path], out_path: Path, scene_type: str = "character") -> Path:
    """יוצר תמונה אחת מ-prompt + תמונות רפרנס, שומר ל-out_path. מחזיר את הנתיב.
    
    scene_type: "character", "place", or "object".
    """
    print(f"[Gemini] מתחיל יצירת תמונה עם מודל: {MODEL} (סוג: {scene_type})")
    print(f"[Gemini] prompt: {prompt[:100]}..." if len(prompt) > 100 else f"[Gemini] prompt: {prompt}")
    print(f"[Gemini] מספר רפרנסים: {len(reference_paths)}")
    
    contents: list = []
    # הרפרנסים קודם — הם מקבעים את הסגנון/מראה; אחריהם ההוראה הטקסטואלית.
    for rp in reference_paths:
        if rp and rp.exists():
            print(f"[Gemini] טוען רפרנס: {rp.name}")
            contents.append(
                types.Part.from_bytes(
                    data=rp.read_bytes(),
                    mime_type=_guess_mime(rp),
                )
            )
    
    if scene_type == "object":
        instruction = (
            "Use the provided reference image(s) ONLY to keep the artistic style consistent. "
            "Focus strictly on the main object. Keep the background simple, clean and uncluttered "
            "as this element will be integrated into other scenes. Do NOT include any characters. "
            "Generate a single illustration for the following object: " + prompt
        )
    elif scene_type == "place":
        instruction = (
            "Use the provided reference image(s) ONLY to keep the artistic style consistent. "
            "Focus on the environment and atmosphere. Do NOT include any characters unless "
            "explicitly mentioned in the prompt. Generate a single illustration for the following place: " + prompt
        )
    else: # character
        instruction = prompt
        if reference_paths:
            instruction = (
                "Use the provided reference image(s) to keep the characters' appearance "
                "consistent and maintain the overall style. Generate a single illustration for the following scene: " + prompt
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
