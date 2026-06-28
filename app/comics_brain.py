"""ה'מוח' של מצב קומיקס — Claude API.

מקבל תיאור קומיקס מפורט (טקסט חופשי) ומפרק אותו לפאנלים: לכל פאנל prompt ויזואלי,
רפרנסים לעקביות דמויות/מקומות, בועות דיבור (dialogue) וכיתוב קריינות (caption).

בניגוד למצב הסטודיו (claude_brain), אין כאן SRT/זמנים/אפקטים — הפלט הוא פאנלים סטטיים.

מודל: claude-opus-4-8, structured output (Pydantic), adaptive thinking.
מפתח: ANTHROPIC_API_KEY (נטען מ-.env דרך main).
"""
from __future__ import annotations

import json
import os

from pydantic import BaseModel, Field

# מיחזור לוגיקת הלקוח, רשימת הרפרנסים והצעת רפרנסים חדשים ממצב הסטודיו
from .claude_brain import MODEL, ProposedReference, _client, _format_references


VALID_SIZES = ("third", "half", "two_thirds", "full", "tall", "big", "splash")

VALID_SHAPES = (
    "rect", "rounded", "circle", "ellipse", "triangle", "diamond",
    "hexagon", "octagon", "parallelogram", "chevron", "star", "burst",
)

VALID_BUBBLE_KINDS = ("speech", "thought", "shout", "whisper")

# רשת המיקום המדויק של בועות הדיבור בתוך כל פאנל (יחסית לפאנל).
# מקור אמת אחד — חייב להיות זהה לקבועים ב-comics.js.
GRID_COLS = 12
GRID_ROWS = 6


# ---------- סכמות פלט מובנה ----------
class GridRect(BaseModel):
    """מלבן ברשת ה-12×6 של הפאנל (col=0..11 משמאל, row=0..5 מלמעלה)."""
    col: int = Field(description="עמודת הפינה הימנית-עליונה (0–11)")
    row: int = Field(description="שורת הפינה העליונה (0–5)")
    w: int = Field(description="רוחב בתאים (לפחות 1)")
    h: int = Field(description="גובה בתאים (לפחות 1)")


def _clamp_rect(r: "GridRect | None") -> dict | None:
    """מצמצם מלבן רשת לגבולות 12×6 ומחזיר dict; None אם אין."""
    if r is None:
        return None
    w = max(1, min(GRID_COLS, int(r.w)))
    h = max(1, min(GRID_ROWS, int(r.h)))
    col = max(0, min(GRID_COLS - w, int(r.col)))
    row = max(0, min(GRID_ROWS - h, int(r.row)))
    return {"col": col, "row": row, "w": w, "h": h}


def _serialize_dialogue(d: "DialogueLine") -> dict:
    out = {
        "speaker": d.speaker,
        "text": d.text,
        "kind": d.kind if d.kind in VALID_BUBBLE_KINDS else "speech",
        "rect": _clamp_rect(d.rect),
    }
    if d.anchor_col >= 0 and d.anchor_row >= 0:
        out["anchor"] = {
            "col": max(0.0, min(float(GRID_COLS), float(d.anchor_col))),
            "row": max(0.0, min(float(GRID_ROWS), float(d.anchor_row))),
        }
    return out


class CharacterZone(BaseModel):
    """אזור שבו דמות ממוקמת בפאנל — בעיקר אזור-הפנים, כיעד לזנב הבועה."""
    ref: str = Field(description="מזהה/שם הדמות בפורמט 'ID|שם' (כמו ב-references)")
    rect: GridRect = Field(description="מלבן הרשת שבו ממוקמת הדמות (בעיקר הראש/פנים)")


class DialogueLine(BaseModel):
    """שורת דיבור בבועה אחת בתוך פאנל."""
    speaker: str = Field(description="שם הדמות שמדברת (עברית). אם זו קריינות/מספר השאר ריק")
    text: str = Field(description="תוכן הבועה בעברית")
    kind: str = Field(default="speech", description=(
        "סוג הבועה: speech (דיבור רגיל), thought (מחשבה — בועת ענן), "
        "shout (צעקה — מסגרת משוננת), whisper (לחישה — מסגרת מקווקוות)"
    ))
    rect: GridRect = Field(description=(
        "מלבן הבועה ברשת 12×6 של הפאנל. בחר את גודל המלבן לפי אורך הטקסט "
        "(טקסט ארוך → מלבן רחב/גבוה יותר; טקסט קצר → מלבן קומפקטי). "
        "מקם את הבועה באזור פנוי שאינו מכסה פנים, קרוב לדובר."
    ))
    # ‎-1 = ‏'לא הוגדר' (נמנע מ-union ‎float | None שמנפח את קומפילציית הדקדוק)
    anchor_col: float = Field(default=-1.0, description="עמודת יעד הזנב (אזור-הפנים של הדובר, 0–12, אפשר עשרוני; ‎-1 אם אין)")
    anchor_row: float = Field(default=-1.0, description="שורת יעד הזנב (0–6, אפשר עשרוני; ‎-1 אם אין)")


VALID_REF_VARIANTS = ("single", "sheet", "both")


class RefVariant(BaseModel):
    """בחירת וריאנט התמונה של רפרנס לשימוש בפאנל זה."""
    ref: str = Field(description="מזהה הרפרנס בפורמט 'ID|שם' (כמו ב-references)")
    variant: str = Field(description=(
        "איזו תמונה של הרפרנס לצרף ליצירת הפאנל: "
        "single (התמונה הבודדת הנקייה — לתקריב/הבעה/זווית חזיתית), "
        "sheet (גיליון רב-זוויות — כשהפאנל דורש פרופיל, גוף מלא, זווית לא-שגרתית או תנועה), "
        "both (שתי התמונות יחד — סצנה מורכבת שבה הדמות מרכזית ובזווית לא טריוויאלית). "
        "חובה לבחור במפורש לכל דמות."
    ))


class ComicPanel(BaseModel):
    """פאנל בודד בקומיקס (תמונה אחת)."""
    panel_number: int = Field(description="מספר הפאנל לפי סדר הקריאה, החל מ-1")
    page: int = Field(default=1, description=(
        "מספר העמוד שאליו שייך הפאנל (החל מ-1). אתה מתכנן את חלוקת הפאנלים לעמודים: "
        "סכום שטחי הפאנלים בכל עמוד צריך למלא בדיוק את רשת העמוד (6×4=24 תאים), ולא לחרוג ממנה. "
        "פאנלים באותו עמוד מקבלים את אותו מספר page, לפי סדר הקריאה."
    ))
    description: str = Field(description="תיאור קצר בעברית של מה קורה בפאנל (לתצוגה לבמאי)")
    prompt: str = Field(description="פרומפט ויזואלי מפורט בעברית ליצירת תמונת הפאנל ב-Gemini")
    references: list[str] = Field(default_factory=list, description="רשימת מזהי רפרנס מהאינדקס בפורמט 'ID|Name'")
    ref_variants: list[RefVariant] = Field(default_factory=list, description=(
        "לכל רפרנס דמות שמופיע ב-references — בחירה מפורשת איזו תמונה לצרף "
        "(single / sheet / both). מלא ערך אחד לכל דמות שמופיעה בפאנל."
    ))
    location: str = Field(default="", description="שם המקום הפיזי שבו מתרחש הפאנל")
    dialogue: list[DialogueLine] = Field(default_factory=list, description="בועות דיבור בפאנל (יכול להיות ריק)")
    caption: str = Field(default="", description="כיתוב קריינות/תיבת טקסט לפאנל (יכול להיות ריק)")
    size: str = Field(default="half", description=(
        "גודל הפאנל ברשת העמוד (6 עמודות דקות × 4 טורים). ערכים: "
        "third (שליש רוחב, 2 עמודות × טור 1 — צר, לרצף מהיר/תקריב), "
        "half (חצי רוחב, 3×1 — ברירת המחדל הנפוצה), "
        "two_thirds (שני-שליש רוחב, 4×1), "
        "full (רוחב מלא, 6×1 — רצועה לרגע מבסס/נוף), "
        "tall (צר וגבוה, 2 עמודות × 2 טורים — פורטרט), "
        "big (גוש גדול, 3×2), "
        "splash (עמוד שלם, 6×4 — לרגע דרמטי מאוד). "
        "תכנן שכל טור יתמלא: חצי+חצי, או שלושה שלישים, או שליש+שני-שליש, או רצועה מלאה."
    ))
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
    characters: list[CharacterZone] = Field(default_factory=list, description=(
        "מיקום כל דמות בפאנל ברשת 12×6 (בעיקר אזור הראש/פנים). משמש גם להוראות הקומפוזיציה "
        "ל-Gemini וגם כיעד לזנב הבועה. מלא רק לדמויות שמדברות או מרכזיות בפאנל."
    ))
    sfx: str = Field(default="", description=(
        "אפקט קול/אונומטופיאה קצר להצגה כטקסט גדול ומסוגנן על הפאנל (למשל 'בום!', 'קְרַאש!'). "
        "השאר ריק אם אין אפקט קול דרמטי."
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
    "6. dialogue — בועות הדיבור בפאנל (ראה 'מיקום מדויק של בועות' למטה). אם אין דיבור, השאר רשימה ריקה.\n"
    "7. caption — תיבת קריינות אם יש (למשל 'בינתיים, בצד השני של העיר...'). אם אין, השאר ריק.\n\n"
    "8. page + size — מספר העמוד וגודל הפאנל ברשת העמוד (ראה 'פריסת העמוד' למטה).\n"
    "9. shape — צורת מסגרת הפאנל (rect ברוב המקרים; צורה מיוחדת רק לרגע דרמטי).\n"
    "10. characters — מיקום כל דמות מרכזית/מדברת בפאנל ברשת 12×6 (ראה למטה).\n"
    "11. sfx — אפקט קול קצר אם יש רגע קולני/דרמטי (אחרת ריק).\n"
    "12. ref_variants — בחירת וריאנט התמונה לכל דמות (ראה 'וריאנט תמונת הרפרנס' למטה).\n\n"
    "וריאנט תמונת הרפרנס (חשוב!):\n"
    "לכל דמות יש שתי תמונות רפרנס זמינות: (א) תמונה בודדת נקייה, (ב) 'גיליון דמות' (sheet) "
    "שמראה את הדמות בכמה זוויות והבעות. עבור כל דמות שמופיעה ב-references של הפאנל, הוסף "
    "ל-ref_variants רשומה {ref, variant} ובחר במפורש:\n"
    "  - single: תקריב, הבעת פנים, או זווית חזיתית פשוטה.\n"
    "  - sheet: כשהפאנל מראה את הדמות בפרופיל, גוף מלא, זווית לא-שגרתית, או בתנועה — "
    "כאן הזוויות המרובות שומרות על עקביות.\n"
    "  - both: סצנה מורכבת שבה הדמות מרכזית ובזווית לא טריוויאלית.\n"
    "התאם את ה-prompt לזווית שבחרת. חובה לבחור variant לכל דמות (אל תשאיר ריק).\n\n"
    "מיקום מדויק של בועות (חשוב מאוד!):\n"
    "כל פאנל מחולק פנימית לרשת עדינה של 12 עמודות (col 0–11, 0=שמאל) × 6 שורות (row 0–5, 0=למעלה).\n"
    "עבור כל דמות מרכזית מלא ב-characters את מלבן אזור-הראש/פנים שלה (ref בפורמט 'ID|שם' + rect).\n"
    "עבור כל בועת דיבור מלא:\n"
    "  - rect: מלבן הבועה ברשת. **בחר את גודל המלבן לפי אורך הטקסט** — משפט קצר ~3×2 תאים, "
    "משפט בינוני ~4×2, משפט ארוך ~5–6×3. מקם את הבועה באזור פנוי (שמיים/קיר/רקע) שאינו מכסה פנים, וקרוב לדובר.\n"
    "  - kind: speech לרוב; thought למחשבה פנימית; shout לצעקה; whisper ללחישה.\n"
    "  - anchor_col/anchor_row: נקודת אזור-הפנים של הדובר (לשם יצביע זנב הבועה).\n"
    "חשוב: האזור שבחרת לבועה צריך להישאר 'נקי' בתמונה — ציין זאת ב-prompt (למשל 'השאר את החלק "
    "השמאלי-עליון של הקומפוזיציה פתוח/שמיים, ללא פרטים, מקום לבועת דיבור'). אל תכתוב את טקסט הבועה בתוך התמונה.\n\n"
    "פריסת העמוד (חשוב מאוד! — אתה מתכנן את העמודים בעצמך):\n"
    "כל עמוד קומיקס הוא רשת של 6 עמודות דקות רוחבית × 4 טורים (שורות) לגובה — סה\"כ 24 תאים.\n"
    "כל גודל (size) תופס רוחב×גובה בתאים: third=2×1, half=3×1, two_thirds=4×1, full=6×1, "
    "tall=2×2, big=3×2, splash=6×4.\n"
    "**אתה אחראי לתכנן את חלוקת הפאנלים לעמודים** — לכל פאנל קבע שדה page (1, 2, 3...):\n"
    "  - הפאנלים בכל עמוד מסודרים אוטומטית לפי סדר panel_number, מימין לשמאל (קריאה בעברית) וטור אחר טור.\n"
    "  - **סכום שטחי הפאנלים בכל עמוד חייב להיות בדיוק 24 תאים (6×4), ולא לחרוג** — תכנן את הגדלים כך "
    "שכל טור (שורה של 6 עמודות) יתמלא בדיוק: שני פאנלים half (3+3), שלושה third (2+2+2), third+two_thirds (2+4), "
    "או full יחיד (6). לדוגמה עמוד שלם: full(6) + half+half(6) + big+tall+tall... כל עוד הסכום 24.\n"
    "  - הימנע מהשארת חורים בטור או בעמוד. שאף לעמודים מאוזנים ומגוונים בגדלים ובצורות.\n"
    "  - אל תדחס יותר מ-24 תאים לעמוד — אם נשארו פאנלים, פתח עמוד חדש (page גדול ב-1).\n"
    "השתמש ב-full/big/splash לרגעים דרמטיים או מבססים, וב-third לרצף מהיר, תקריבים או רגעים קצרים.\n"
    "שים לב: אם בחרת shape לא-מלבני (circle/triangle/burst וכו') התמונה תיחתך לצורה — שמור את "
    "הנושא המרכזי במרכז הפאנל.\n\n"
    "עקרונות במאי:\n"
    "- עגן כל פאנל במקום פיזי ושמור על עקביות דמויות (אותו ID/שם לאורך הקומיקס).\n"
    "- בחר את הרגע הדרמטי/המעניין ביותר בכל קטע.\n"
    "- גוון בזוויות ובקומפוזיציה בין פאנלים (תקריב, רחב, מלמעלה) וגם בגדלים ובצורות.\n"
    "- כמות הפאנלים צריכה לשקף את עושר התיאור; אל תדחס יותר מדי לפאנל אחד."
)


def _build_user_msg(description: str, references: dict, style_description: str = "",
                    director_instructions: str = "", panels_target: int | None = None,
                    pages_target: int | None = None) -> str:
    msg = ""
    if pages_target:
        msg += (
            f"יעד מספר עמודים: {pages_target}. תכנן את הקומיקס כך שיתפרס על בדיוק "
            f"{pages_target} עמודים, וכל עמוד יתמלא במלואו (24 תאים). קבע את שדה page של כל "
            f"פאנל בהתאם (1..{pages_target}), ובחר את כמות הפאנלים והגדלים כך שכל עמוד יהיה מלא.\n\n"
        )
    elif panels_target:
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
                   director_instructions: str = "", panels_target: int | None = None,
                   pages_target: int | None = None) -> str:
    """מחזיר את הפרומפט הסופי שהיה נשלח ל-Claude, ללא שליחה בפועל."""
    user_msg = _build_user_msg(description, references, style_description, director_instructions,
                               panels_target, pages_target)
    return f"--- SYSTEM PROMPT ---\n{SYSTEM_PROMPT}\n\n--- USER MESSAGE ---\n{user_msg}"


def propose_panels(description: str, references: dict, style_description: str = "",
                   director_instructions: str = "", panels_target: int | None = None,
                   pages_target: int | None = None, custom_prompt: str | None = None) -> dict:
    """מציע פאנלים לקומיקס. מחזיר dict עם panels (כסצנות) ו-new_references."""
    if not (description or "").strip() and not custom_prompt:
        return {"scenes": [], "new_references": []}

    user_msg = custom_prompt or _build_user_msg(
        description, references, style_description, director_instructions, panels_target, pages_target
    )

    # פרסור JSON ידני במקום structured-output מאולץ: הסכמה של ComicProposal עמוקה מדי
    # והקומפילציה של הדקדוק (grammar) ב-API נכשלת ב-timeout. לכן מטמיעים את הסכמה
    # בפרומפט ומפרסרים את התשובה ידנית עם Pydantic.
    schema_json = json.dumps(ComicProposal.model_json_schema(), ensure_ascii=False, indent=2)
    json_instruction = (
        "\n\n=== פורמט הפלט (חובה!) ===\n"
        "החזר אך ורק אובייקט JSON יחיד ותקין התואם בדיוק לסכמה הבאה (JSON Schema). "
        "אל תוסיף טקסט לפני או אחרי, אל תעטוף ב-```json, ואל תוסיף הסברים.\n"
        f"{schema_json}\n"
    )

    print(f"[Comics] שולח בקשה למודל: {MODEL} (אורך הודעה: {len(user_msg)} תווים)")

    kwargs = {
        "model": MODEL,
        "max_tokens": 16000,
        "system": SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": user_msg + json_instruction}],
    }
    if "opus" in MODEL.lower():
        kwargs["thinking"] = {"type": "adaptive"}

    try:
        resp = _client().messages.create(**kwargs)
    except Exception as e:
        print(f"[Comics ERROR] שגיאה בקריאה ל-API: {type(e).__name__}: {e}")
        raise

    raw = "".join(b.text for b in resp.content if getattr(b, "type", None) == "text").strip()
    if not raw:
        raise RuntimeError("Claude לא החזיר טקסט")

    # ניקוי code fences אם המודל בכל זאת עטף ב-```json
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    # חיתוך לאובייקט ה-JSON עצמו אם נוסף טקסט מסביב
    start, end = raw.find("{"), raw.rfind("}")
    if start != -1 and end != -1:
        raw = raw[start : end + 1]

    try:
        proposal = ComicProposal.model_validate_json(raw)
    except Exception as e:
        print(f"[Comics ERROR] פלט JSON לא תקין: {type(e).__name__}: {e}\n--- raw ---\n{raw[:2000]}")
        raise RuntimeError("Claude החזיר JSON לא ולידי") from e

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
            "ref_variants": [
                {"ref": rv.ref, "variant": rv.variant if rv.variant in VALID_REF_VARIANTS else "single"}
                for rv in panel.ref_variants
            ],
            "location": panel.location,
            "dialogue": [_serialize_dialogue(d) for d in panel.dialogue],
            "caption": panel.caption,
            "page": max(1, int(panel.page or 1)),
            "size": panel.size if panel.size in VALID_SIZES else "half",
            "shape": panel.shape if panel.shape in VALID_SHAPES else "rect",
            "characters": [{"ref": c.ref, "rect": _clamp_rect(c.rect)} for c in panel.characters],
            "sfx": (panel.sfx or "").strip(),
            "image_path": None,
            "status": "proposed",
        })

    return {"scenes": scenes, "new_references": new_refs_list}
