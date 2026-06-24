"""ה'מוח' של מצב קומיקס — Claude API.

מקבל תיאור קומיקס מפורט (טקסט חופשי) ומפרק אותו לפאנלים: לכל פאנל prompt ויזואלי,
רפרנסים לעקביות דמויות/מקומות, בועות דיבור (dialogue) וכיתוב קריינות (caption).

בניגוד למצב הסטודיו (claude_brain), אין כאן SRT/זמנים/אפקטים — הפלט הוא פאנלים סטטיים.

מודל: claude-opus-4-8, structured output (Pydantic), adaptive thinking.
מפתח: ANTHROPIC_API_KEY (נטען מ-.env דרך main).
"""
from __future__ import annotations

import os

from pydantic import BaseModel, Field

# מיחזור לוגיקת הלקוח, רשימת הרפרנסים והצעת רפרנסים חדשים ממצב הסטודיו
from .claude_brain import MODEL, ProposedReference, _client, _format_references


VALID_SHAPES = (
    "rect", "rounded", "circle", "ellipse", "triangle", "diamond",
    "hexagon", "octagon", "parallelogram", "chevron", "star", "burst",
)


# ---------- סכמות פלט מובנה ----------
class DialogueLine(BaseModel):
    """שורת דיבור בבועה אחת בתוך פאנל."""
    speaker: str = Field(description="שם הדמות שמדברת (עברית). אם זו קריינות/מספר השאר ריק")
    text: str = Field(description="תוכן הבועה בעברית")


class ComicPanel(BaseModel):
    """פאנל בודד בקומיקס (תמונה אחת)."""
    panel_number: int = Field(description="מספר הפאנל לפי סדר הקריאה, החל מ-1")
    description: str = Field(description="תיאור קצר בעברית של מה קורה בפאנל (לתצוגה לבמאי)")
    prompt: str = Field(description="פרומפט ויזואלי מפורט בעברית ליצירת תמונת הפאנל ב-Gemini")
    references: list[str] = Field(default_factory=list, description="רשימת מזהי רפרנס מהאינדקס בפורמט 'ID|Name'")
    location: str = Field(default="", description="שם המקום הפיזי שבו מתרחש הפאנל")
    dialogue: list[DialogueLine] = Field(default_factory=list, description="בועות דיבור בפאנל (יכול להיות ריק)")
    caption: str = Field(default="", description="כיתוב קריינות/תיבת טקסט לפאנל (יכול להיות ריק)")
    size: str = Field(default="regular", description="גודל הפאנל בעמוד: regular (רגיל), wide (רחב), tall (גבוה), big (גדול). השתמש ב-big/wide לרגעים דרמטיים")
    shape: str = Field(default="rect", description=(
        "צורת מסגרת הפאנל בעמוד. ערכים אפשריים: "
        "rect (מלבן רגיל - ברירת מחדל לרוב הפאנלים), "
        "rounded (פינות מעוגלות - לרגעים רכים/חמים), "
        "circle (עיגול - לקלוז-אפ, פלאשבק, או הצצה רגעית), "
        "ellipse (אליפסה), "
        "triangle (משולש), "
        "diamond (מעוין - להדגשה), "
        "hexagon (משושה), "
        "octagon (מתומן), "
        "parallelogram (מקבילית/חיתוך אלכסוני - מצוין לסצנות אקשן, תנועה ומתח), "
        "chevron (חץ), "
        "star (כוכב), "
        "burst (פיצוץ משונן - לרגעי הלם, פיצוץ, התרגשות או הפתעה). "
        "בחר צורה מיוחדת רק לרגע דרמטי שמצדיק זאת, אחרת השתמש ב-rect."
    ))


class ComicProposal(BaseModel):
    """הצעת Claude לכלל הפאנלים של הקומיקס."""
    new_references: list[ProposedReference] = Field(default_factory=list, description="רפרנסים חדשים שיש לייצר עבור הקומיקס")
    panels: list[ComicPanel] = Field(description="רשימת כל הפאנלים של הקומיקס לפי סדר הקריאה")


SYSTEM_PROMPT = (
    "אתה במאי קומיקס. תפקידך לקחת תיאור עלילה/סצנריו של קומיקס ולפרק אותו לפאנלים ויזואליים "
    "מוכנים ליצירת תמונות.\n\n"
    "כל התקשורת איתך — הפרומפטים, התיאורים, הדיאלוגים — בעברית בלבד.\n\n"
    "שלב 1: ניתוח רפרנסים (עקביות)\n"
    "סקור את 'אינדקס הרפרנסים'. השתמש ברפרנסים קיימים עבור דמויות/מקומות/חפצים שכבר מופיעים בו, "
    "בפורמט 'ID|שם' (למשל 'hero-dan|דן הגיבור'). אל תמציא מזהים לדמויות קיימות. "
    "אם זיהית דמות/מקום/חפץ חדש ומשמעותי שאינו באינדקס — הצע אותו ב-new_references עם ID קצר באנגלית, "
    "שם בעברית ייחודי, ותיאור ויזואלי מפורט שמגדיר את המראה.\n\n"
    "שלב 2: חלוקה לפאנלים\n"
    "חלק את התיאור לפאנלים לפי סדר הקריאה. כל פאנל הוא תמונה אחת שלוכדת רגע אחד.\n"
    "עבור כל פאנל:\n"
    "1. panel_number לפי הסדר (החל מ-1).\n"
    "2. description — משפט קצר בעברית שמסביר מה קורה בפאנל.\n"
    "3. prompt — פרומפט ויזואלי מפורט בעברית: מי בתמונה, מה הם עושים, הרקע, זווית/קומפוזיציה, "
    "הבעות פנים ורגש. אל תכתוב את הטקסט של הבועות בתוך התמונה — הבועות יתווספו בנפרד.\n"
    "4. references — הדמויות/המקומות שמופיעים בפאנל בפורמט 'ID|שם'. קשר רפרנס-מקום (קטגוריה style) "
    "כדי שאותו מקום ייראה זהה כשהוא חוזר.\n"
    "5. location — שם המקום הפיזי.\n"
    "6. dialogue — בועות הדיבור בפאנל (speaker + text). אם אין דיבור, השאר רשימה ריקה.\n"
    "7. caption — תיבת קריינות אם יש (למשל 'בינתיים, בצד השני של העיר...'). אם אין, השאר ריק.\n\n"
    "עקרונות במאי:\n"
    "- עגן כל פאנל במקום פיזי ושמור על עקביות דמויות (אותו ID/שם לאורך הקומיקס).\n"
    "- בחר את הרגע הדרמטי/המעניין ביותר בכל קטע.\n"
    "- גוון בזוויות ובקומפוזיציה בין פאנלים (תקריב, רחב, מלמעלה).\n"
    "- כמות הפאנלים צריכה לשקף את עושר התיאור; אל תדחס יותר מדי לפאנל אחד."
)


def _build_user_msg(description: str, references: dict, style_description: str = "",
                    director_instructions: str = "", panels_target: int | None = None) -> str:
    msg = ""
    if panels_target:
        msg += f"יעד מספר פאנלים (משוער): {panels_target}\n\n"
    if director_instructions:
        msg += f"=== הוראות במאי מיוחדות ===\n{director_instructions}\n\n"
    if style_description:
        msg += f"=== סגנון ויזואלי (Style) ===\n{style_description}\n\n"
    msg += (
        f"=== אינדקס רפרנסים ===\n{_format_references(references)}\n\n"
        f"=== תיאור הקומיקס ===\n{description}\n\n"
    )
    return msg


def preview_prompt(description: str, references: dict, style_description: str = "",
                   director_instructions: str = "", panels_target: int | None = None) -> str:
    """מחזיר את הפרומפט הסופי שהיה נשלח ל-Claude, ללא שליחה בפועל."""
    user_msg = _build_user_msg(description, references, style_description, director_instructions, panels_target)
    return f"--- SYSTEM PROMPT ---\n{SYSTEM_PROMPT}\n\n--- USER MESSAGE ---\n{user_msg}"


def propose_panels(description: str, references: dict, style_description: str = "",
                   director_instructions: str = "", panels_target: int | None = None,
                   custom_prompt: str | None = None) -> dict:
    """מציע פאנלים לקומיקס. מחזיר dict עם panels (כסצנות) ו-new_references."""
    if not (description or "").strip() and not custom_prompt:
        return {"scenes": [], "new_references": []}

    user_msg = custom_prompt or _build_user_msg(
        description, references, style_description, director_instructions, panels_target
    )

    print(f"[Comics] שולח בקשה למודל: {MODEL} (אורך הודעה: {len(user_msg)} תווים)")

    kwargs = {
        "model": MODEL,
        "max_tokens": 16000,
        "system": SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": user_msg}],
        "output_format": ComicProposal,
    }
    if "opus" in MODEL.lower():
        kwargs["thinking"] = {"type": "adaptive"}

    try:
        resp = _client().messages.parse(**kwargs)
    except Exception as e:
        print(f"[Comics ERROR] שגיאה בקריאה ל-API: {type(e).__name__}: {e}")
        raise

    proposal = resp.parsed_output
    if proposal is None:
        raise RuntimeError("Claude לא החזיר פלט ולידי")

    print(f"[Comics] התקבלו {len(proposal.panels)} פאנלים ו-{len(proposal.new_references)} רפרנסים חדשים")

    new_refs_list = []
    for r in proposal.new_references:
        new_refs_list.append({
            "id": r.id, "name": r.name, "description": r.description, "category": r.category,
            "age": r.age, "height": r.height, "mood": r.mood, "time_of_day": r.time_of_day,
            "material": r.material, "condition": r.condition, "status": "proposed",
        })

    scenes = []
    for i, panel in enumerate(sorted(proposal.panels, key=lambda p: p.panel_number), start=1):
        scenes.append({
            "scene_id": f"panel-{i}",
            "panel_number": i,
            "description": panel.description,
            "prompt": panel.prompt,
            "references": panel.references,
            "location": panel.location,
            "dialogue": [{"speaker": d.speaker, "text": d.text} for d in panel.dialogue],
            "caption": panel.caption,
            "size": panel.size if panel.size in ("regular", "wide", "tall", "big") else "regular",
            "shape": panel.shape if panel.shape in VALID_SHAPES else "rect",
            "image_path": None,
            "status": "proposed",
        })

    return {"scenes": scenes, "new_references": new_refs_list}
