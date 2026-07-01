"""ניהול ואחסון ספרים מותאמים אישית (book.json).

מבנה תיקיות:
  data/books/<book_id>/book.json           — נתוני הספר, עמודים, טקסטים, ופרומפטים
  data/books/<book_id>/images/<filename>   — תמונות המשויכות לעמודי הספר
"""
from __future__ import annotations

import json
import re
import shutil
import uuid
from pathlib import Path

# שורש הפרויקט
ROOT = Path(__file__).resolve().parent.parent
BOOKS_DIR = ROOT / "data" / "books"
STUDIO_DIR = ROOT / "data" / "studio"

def _slugify(text: str) -> str:
    """מזהה בטוח לתיקייה/URL — שומר עברית ומסיר תווים בעייתיים."""
    text = text.strip().replace(" ", "-")
    text = re.sub(r"[\\/:*?\"<>|]+", "-", text)
    return re.sub(r"-{2,}", "-", text).strip("-")

def get_book_dir(book_id: str) -> Path:
    d = BOOKS_DIR / book_id
    d.mkdir(parents=True, exist_ok=True)
    (d / "images").mkdir(parents=True, exist_ok=True)
    return d

def get_book_path(book_id: str) -> Path:
    return get_book_dir(book_id) / "book.json"

def list_books() -> list[dict]:
    """מחזיר את כל הספרים הקיימים במערכת."""
    results = []
    if BOOKS_DIR.exists():
        for b_dir in BOOKS_DIR.iterdir():
            if not b_dir.is_dir():
                continue
            b_json = b_dir / "book.json"
            if b_json.exists():
                try:
                    with open(b_json, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    results.append({
                        "book_id": b_dir.name,
                        "title": data.get("title", b_dir.name),
                        "pages_count": len(data.get("pages", [])),
                        "created_from_mishna": data.get("created_from_mishna"),
                    })
                except Exception:
                    continue
    return results

def load_book(book_id: str) -> dict:
    """טוען ספר קיים."""
    p = get_book_path(book_id)
    if not p.exists():
        raise FileNotFoundError(f"לא נמצא ספר עם המזהה {book_id}")
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)

def save_book(book_id: str, data: dict) -> None:
    """שומר נתוני ספר."""
    p = get_book_path(book_id)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def create_empty_book(title: str, book_id: str | None = None) -> dict:
    """יוצר ספר ריק חדש."""
    if not book_id:
        book_id = _slugify(title)
        if not book_id:
            book_id = f"book-{uuid.uuid4().hex[:6]}"
            
    # מניעת דריסה של ספר קיים
    orig_id = book_id
    counter = 1
    while get_book_path(book_id).exists():
        book_id = f"{orig_id}-{counter}"
        counter += 1

    book_data = {
        "book_id": book_id,
        "title": title,
        "created_from_mishna": None,
        "style_description": "ספר ילדים מאויר, צבעוני ומתוק, סגנון תלת-ממדי פיקסאר/דיסני",
        "pages": []
    }
    save_book(book_id, book_data)
    return book_data

def create_book_from_project(title: str, mishna_id: str, book_id: str | None = None) -> dict:
    """יוצר ספר המבוסס על פרויקט וידאו קיים."""
    from .project_store import load_or_init_project, studio_dir
    
    project = load_or_init_project(mishna_id)
    
    if not book_id:
        book_id = _slugify(title or project.get("title", mishna_id))
        if not book_id:
            book_id = f"book-{uuid.uuid4().hex[:6]}"
            
    orig_id = book_id
    counter = 1
    while get_book_path(book_id).exists():
        book_id = f"{orig_id}-{counter}"
        counter += 1
        
    book_dir = get_book_dir(book_id)
    images_dir = book_dir / "images"
    
    pages = []
    page_num = 1
    
    proj_dir = studio_dir(mishna_id)
    
    # נעבור על כל הסצנות בפרויקט
    for slot in project.get("slots", []):
        for scene in slot.get("scenes", []):
            image_path = scene.get("image_path")
            if not image_path:
                continue
                
            src_img = proj_dir / image_path
            if src_img.exists():
                # העתקת התמונה לתיקיית הספר
                dest_filename = f"page_{page_num:03d}_{src_img.name}"
                shutil.copy2(src_img, images_dir / dest_filename)
                
                # אם יש טקסט משנה נשתמש בו, אחרת בפרומפט קצר, או שנשאיר לעיבוד קלוד
                original_text = scene.get("mishna_text") or scene.get("prompt", "")
                
                # יצירת עמוד
                pages.append({
                    "page_id": f"page-{uuid.uuid4().hex[:6]}",
                    "page_num": page_num,
                    "text": original_text,  # טקסט ראשוני
                    "image_path": f"images/{dest_filename}",
                    "prompt": scene.get("prompt", ""),
                    "references": scene.get("references", []),
                    "status": "imported"
                })
                page_num += 1
                
    book_data = {
        "book_id": book_id,
        "title": title or project.get("title", mishna_id),
        "created_from_mishna": mishna_id,
        "style_description": project.get("style_description", "ספר ילדים מאויר, צבעוני ומתוק, סגנון תלת-ממדי פיקסאר/דיסני"),
        "pages": pages
    }
    
    save_book(book_id, book_data)
    return book_data
