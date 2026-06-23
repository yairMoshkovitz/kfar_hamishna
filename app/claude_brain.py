"""ה'מוח' — Claude API. מציע משבצות (slots): מתי להציג תמונה, prompt ליצירה, ורפרנסים.

מודל: claude-opus-4-8, structured output (Pydantic) ל-JSON ולידי, adaptive thinking.
מפתח: ANTHROPIC_API_KEY (נטען מ-.env דרך main).
"""
from __future__ import annotations

import os

import anthropic
from pydantic import BaseModel, Field

from .srt_parser import SrtCue, parse_srt, seconds_to_timestamp, total_duration

MODEL = os.environ.get("CLAUDE_MODEL", "claude-opus-4-8")


# ---------- סכמות פלט מובנה ----------
class ProposedScene(BaseModel):
    """סצנה בודדת (תמונה אחת)."""
    start: str = Field(description="בול זמן התחלה מדויק HH:MM:SS.mmm מתוך ה-SRT")
    end: str = Field(description="בול זמן סיום מדויק HH:MM:SS.mmm")
    mishna_text: str = Field(description="טקסט המשנה המקורי התואם לסצנה הזו (עברית)")
    prompt: str = Field(description="פרומפט מפורט בעברית ליצירת תמונה ב-Gemini, התואם לתוכן ולסגנון הציורי של כפר המשנה")
    references: list[str] = Field(default_factory=list, description="רשימת מזהי רפרנס מהאינדקס בפורמט 'ID|Name' (למשל 'rab-chisda|רב חסדא')")
    duration: float = Field(description="כמה שניות התמונה נשארת על המסך")
    effect: str = Field(default="ken_burns", description="אפקט תנועה לתמונה. אחד מ: static, zoom_in, zoom_out, pan_left, pan_right, pan_up, pan_down, ken_burns")
    intensity: str = Field(default="medium", description="עוצמת האפקט: subtle (עדין), medium (בינוני), strong (חזק)")


class ProposedReference(BaseModel):
    """הצעה לרפרנס חדש שיש ליצור (דמות, מקום או חפץ)."""
    id: str = Field(description="מזהה ייחודי קצר באנגלית (למשל rab-chisda, golden-bowl)")
    name: str = Field(description="שם הרפרנס בעברית")
    description: str = Field(description="תיאור ויזואלי מפורט בעברית ליצירת מראה עקבי")
    category: str = Field(description="קטגוריה: characters, style, או items")
    
    # שדות לדמויות
    age: str | None = Field(None, description="גיל משוער (לדמויות)")
    height: str | None = Field(None, description="גובה או מבנה גוף (לדמויות)")
    
    # שדות למקומות (style)
    mood: str | None = Field(None, description="אווירה (למקומות), למשל: מואר, עתיק")
    time_of_day: str | None = Field(None, description="שעה ביום (למקומות)")
    
    # שדות לחפצים (items)
    material: str | None = Field(None, description="חומר (לחפצים), למשל: זהב, עץ")
    condition: str | None = Field(None, description="מצב (לחפצים), למשל: חדש, שבור")

class ProjectProposal(BaseModel):
    """הצעת Claude לכלל הסצנות בפרויקט."""
    new_references: list[ProposedReference] = Field(default_factory=list, description="רשימת רפרנסים חדשים שיש לייצר עבור הפרק הזה")
    scenes: list[ProposedScene] = Field(description="רשימת כל הסצנות (תמונות) של הפרק מתחילתו ועד סופו ברצף")


class RepromptResult(BaseModel):
    prompt: str
    references: list[str] = Field(default_factory=list)


class SingleSlotResult(BaseModel):
    mishna_text: str = Field(default="", description="טקסט המשנה המקורי התואם לקטע הזה (עברית)")
    prompt: str = Field(description="פרומפט מפורט בעברית ליצירת תמונה ב-Gemini")
    references: list[str] = Field(default_factory=list, description="רשימת מזהי רפרנס מהאינדקס בפורמט 'ID|Name'")


# ---------- בניית קלט ----------
def _format_cues(cues: list[SrtCue]) -> str:
    return "\n".join(
        f"[{seconds_to_timestamp(c.start)} --> {seconds_to_timestamp(c.end)}] {c.text}"
        for c in cues
    )


def _format_references(refs: dict) -> str:
    lines = []
    for r in refs.get("references", []):
        # מסננים רפרנסים רדומים כדי שלא יבלבלו את קלוד
        if r.get("dormant"):
            continue
        lines.append(f"- ID: {r['id']} (שם: {r.get('name','')}) | קטגוריה: {r.get('category','')} | תיאור: {r.get('description','')}")
    return "\n".join(lines) if lines else "(אין רפרנסים זמינים)"


SYSTEM_PROMPT = (
    "אתה במאי ויזואלי לסדרת פודקאסט עלילתית בשם 'כפר המשנה', המלמדת משנה דרך דמויות מצוירות בסגנון יהודי עתיק. "
    "תפקידך הוא לנתח תמלול של פרק ולתכנן את הסצנות הוויזואליות שלו.\n\n"
    "כל התקשורת איתך, כולל הפרומפטים ליצירת התמונה ותיאורי הרפרנסים, תתבצע בעברית בלבד.\n\n"
    "עליך לפעול לפי השלבים הבאים:\n\n"
    "שלב 1: ניתוח רפרנסים (עקביות דמויות)\n"
    "סקור את 'אינדקס הרפרנסים' שקיבלת. עליך להשתמש ברפרנסים הקיימים עבור דמויות, מקומות או חפצים שכבר מופיעים באינדקס.\n"
    "כאשר אתה משתמש ברפרנס קיים, עליך לספק אותו בפורמט 'ID|שם' (למשל: 'rav-chisda|רב חסדא').\n"
    "אל תמציא מזהים (IDs) חדשים עבור דמויות קיימות!\n"
    "אם זיהית דמות, מקום או חפץ חדש ומשמעותי שאינו מופיע באינדקס, עליך להציע אותו ב-new_references. "
    "לכל רפרנס חדש:\n"
    "- ספק ID קצר וקליט באנגלית (למשל: rav-pappa).\n"
    "- ספק שם בעברית (חייב להיות ייחודי).\n"
    "- ספק תיאור ויזואלי מפורט בעברית המגדיר את המראה שלו (גיל, לבוש, מבנה גוף לדמויות; אווירה למקומות).\n\n"
    "שלב 2: חלוקה לסצנות\n"
    "חלק את התמלול לסצנות רציפות המכסות את כל זמן הפרק, ללא חפיפות או פערים. "
    "עליך לעמוד ביעד של כ-images_per_minute סצנות לכל דקת שידור בממוצע. "
    "שים לב: חשוב מאוד לא לתת מעט מדי סצנות; אם הפרק ארוך, ודא שמספר הסצנות הכולל אכן משקף את היעד שצוין.\n\n"
    "עבור כל סצנה:\n"
    "1. קבע תזמון מדויק (start/end) מתוך ה-SRT.\n"
    "2. זהה את טקסט המשנה המקורי (בעברית) המתאים לסצנה ושים אותו ב-mishna_text.\n"
    "3. בחר את הרפרנסים המופיעים בסצנה מתוך האינדקס (הקיים או החדש שהצעת) בפורמט 'ID|שם'.\n"
    "4. כתוב Prompt ויזואלי מפורט בעברית. ה-Prompt חייב לכלול תיאור של ההתרחשות, הרקע, ופעולות הדמויות המשתתפות.\n"
    "5. בחר אפקט תנועה (effect) ועוצמה (intensity) לתמונה כדי שהסרטון יהיה דינמי וחי:\n"
    "   - האפקטים האפשריים: static (ללא תנועה), zoom_in (התקרבות), zoom_out (התרחקות), "
    "pan_left/pan_right/pan_up/pan_down (הזזה לכיוון), ken_burns (זום + הזזה משולבים).\n"
    "   - העוצמות: subtle (עדין), medium (בינוני), strong (חזק).\n"
    "   - בחר לפי תוכן הסצנה: zoom_in לרגעי מתח או התקרבות לדמות; zoom_out לחשיפת תמונה רחבה; "
    "pan לנופים/סצנות רחבות; ken_burns כברירת מחדל לסצנות רגילות; static לרגעים סטטיים או טקסט.\n"
    "   - חשוב לגוון: אל תחזור על אותו אפקט באותה עוצמה בכמה סצנות רצופות.\n\n"
    "דגשים חשובים:\n"
    "- **התאמה לתזמון**: חשוב מאוד שהפרומפט הויזואלי והתמונה שתיווצר ישקפו את מה ששומעים ב**התחלת** קטע הזמן של הסצנה (בזמן ה-start), ולא באמצע או בסוף הקטע. התאם את התיאור הוויזואלי כך שהתמונה תתאים בדיוק למילים הראשונות שנשמעות כשהסצנה מתחילה.\n"
    "- שמור על עקביות: אם דמות הופיעה בסצנה אחת, השתמש באותו ID ושם שלה גם בסצנות הבאות.\n"
    "- כל התשובות, הנימוקים והפרומפטים חייבים להיות בעברית."
)


def _client() -> anthropic.Anthropic:
    """יוצר לקוח Anthropic. משתמש ב-proxy רק אם מוגדר GEMINI_PROXY או CLAUDE_PROXY בסביבה."""
    import httpx
    
    # משתמש ב-GEMINI_PROXY כברירת מחדל אם מוגדר (זה הפרוקסי הכללי כרגע)
    proxy_url = os.environ.get("GEMINI_PROXY") or os.environ.get("CLAUDE_PROXY")
    
    if proxy_url:
        print(f"[Claude] משתמש ב-proxy: {proxy_url}")
        # ביטול אימות SSL כדי לעבוד דרך ה-SSH Tunnel בלי שגיאות תעודה
        # ומכיוון שמדובר ב-SOCKS5, httpx יודע לטפל בזה
        http_client = httpx.Client(
            verify=False,
            proxy=proxy_url
        )
        return anthropic.Anthropic(http_client=http_client)
    
    return anthropic.Anthropic()  # קורא ANTHROPIC_API_KEY מהסביבה ומשתמש בחיבור ישיר


def preview_prompt(srt_path: str, images_per_minute: float, references: dict, plot_path: str | None = None, director_instructions: str = "", style_description: str = "") -> str:
    """מחזיר רק את הפרומפט הסופי שהיה נשלח ל-Claude, ללא שליחה בפועל."""
    cues = parse_srt(srt_path)
    if not cues:
        return "שגיאה: לא נמצא SRT תקין."
    
    duration = total_duration(cues)
    full_srt_text = _format_cues(cues)
    
    plot_text = ""
    if plot_path:
        from pathlib import Path
        p = Path(__file__).resolve().parent.parent / plot_path
        if p.exists():
            with open(p, "r", encoding="utf-8") as f:
                plot_text = f.read()
                
    total_target_scenes = int((duration / 60) * images_per_minute)
    user_msg = (
        f"images_per_minute (יעד ממוצע): {int(images_per_minute)}\n"
        f"אורך הפרק: {seconds_to_timestamp(duration)} ({duration:.1f} שניות)\n"
        f"סה\"כ יעד: כ-{total_target_scenes} סצנות לכל הפרק.\n\n"
    )
    
    if director_instructions:
        user_msg += f"=== הוראות במאי מיוחדות ===\n{director_instructions}\n\n"
    
    if style_description:
        user_msg += f"=== סגנון ויזואלי (Style) ===\n{style_description}\n\n"
        
    user_msg += (
        f"=== עלילה ===\n{plot_text}\n\n"
        f"=== אינדקס רפרנסים ===\n{_format_references(references)}\n\n"
        f"=== תמלול מתוזמן מלא (SRT) ===\n{full_srt_text}\n\n"
    )
    
    return f"--- SYSTEM PROMPT ---\n{SYSTEM_PROMPT}\n\n--- USER MESSAGE ---\n{user_msg}"

def propose_slots(srt_path: str, images_per_minute: float, references: dict, existing_slots: list[dict] | None = None, plot_path: str | None = None, director_instructions: str = "", style_description: str = "", custom_prompt: str | None = None) -> list[dict]:
    """מציע סצנות (תמונות) לכל הפרויקט בצורה חופשית ללא תלות בדקות קשיחות."""
    cues = parse_srt(srt_path)
    if not cues:
        return []
    
    duration = total_duration(cues)
    
    if custom_prompt:
        user_msg = custom_prompt
        print(f"[Claude] משתמש ב-Custom Prompt שהוזן מה-UI")
    else:
        full_srt_text = _format_cues(cues)
        
        plot_text = ""
        if plot_path:
            from pathlib import Path
            p = Path(__file__).resolve().parent.parent / plot_path
            if p.exists():
                with open(p, "r", encoding="utf-8") as f:
                    plot_text = f.read()
        
        print(f"[Claude] מעבד פרק כולל של {duration:.1f} שניות עם יעד ממוצע של {images_per_minute} תמונות לדקה")
        
        # נשלח הכל ביחד ל-Claude
        total_target_scenes = int((duration / 60) * images_per_minute)
        user_msg = (
            f"images_per_minute (יעד ממוצע): {int(images_per_minute)}\n"
            f"אורך הפרק: {seconds_to_timestamp(duration)} ({duration:.1f} שניות)\n"
            f"סה\"כ יעד: כ-{total_target_scenes} סצנות לכל הפרק.\n\n"
        )
        if director_instructions:
            user_msg += f"=== הוראות במאי מיוחדות ===\n{director_instructions}\n\n"
        
        if style_description:
            user_msg += f"=== סגנון ויזואלי (Style) ===\n{style_description}\n\n"
            
        user_msg += (
            f"=== עלילה ===\n{plot_text}\n\n"
            f"=== אינדקס רפרנסים ===\n{_format_references(references)}\n\n"
            f"=== תמלול מתוזמן מלא (SRT) ===\n{full_srt_text}\n\n"
        )
    
    print(f"[Claude] שולח בקשה למודל: {MODEL}")
    print(f"[Claude] אורך הודעה: {len(user_msg)} תווים")
    
    try:
        kwargs = {
            "model": MODEL,
            "max_tokens": 16000,
            "system": SYSTEM_PROMPT,
            "messages": [{"role": "user", "content": user_msg}],
            "output_format": ProjectProposal,
        }
        
        if "opus" in MODEL.lower():
            kwargs["thinking"] = {"type": "adaptive"}
            
        resp = _client().messages.parse(**kwargs)
    except Exception as e:
        print(f"[Claude ERROR] שגיאה בקריאה ל-API: {type(e).__name__}: {e}")
        raise
    
    proposal = resp.parsed_output
    if proposal is None:
        raise RuntimeError("Claude לא החזיר פלט ולידי")
    
    print(f"[Claude] התקבלו {len(proposal.scenes)} סצנות ו-{len(proposal.new_references)} רפרנסים חדשים")
    
    new_refs_list = []
    for r in proposal.new_references:
        new_refs_list.append({
            "id": r.id,
            "name": r.name,
            "description": r.description,
            "category": r.category,
            "age": r.age,
            "height": r.height,
            "mood": r.mood,
            "time_of_day": r.time_of_day,
            "material": r.material,
            "condition": r.condition,
            "status": "proposed"
        })

    updated_scenes = []
    for i, scene in enumerate(proposal.scenes, start=1):
        updated_scenes.append({
            "scene_id": f"scene-{i}",
            "start": scene.start,
            "end": scene.end,
            "mishna_text": scene.mishna_text,
            "prompt": scene.prompt,
            "references": scene.references,
            "duration": scene.duration,
            "effect": scene.effect,
            "intensity": scene.intensity,
            "image_path": None,
            "status": "proposed",
        })
        
    slots = [{
        "id": "full-project-slot",
        "minute_index": 0,
        "start": "00:00:00.000",
        "end": seconds_to_timestamp(duration),
        "duration": duration,
        "scenes": updated_scenes,
        "new_references": new_refs_list,
        "status": "proposed",
    }]
    
    return slots


def propose_single_slot(slot: dict, references: dict) -> dict:
    """מציע mishna_text, prompt ורפרנסים למשבצת בודדת."""
    user_msg = (
        f"=== אינדקס רפרנסים ===\n{_format_references(references)}\n\n"
        f"זמן המשבצת: {slot.get('start','')} -> {slot.get('end','')}\n"
        f"תמלול הקטע (SRT): {slot.get('text','')}\n\n"
        "עבור משבצת בודדת זו:\n"
        "1. זהה את טקסט המשנה המקורי (עברית) התואם לקטע — שים ב-mishna_text.\n"
        "2. בחר רפרנסים מתאימים בפורמט 'ID|שם' לשמירת עקביות דמויות/סגנון.\n"
        "3. ספק prompt ויזואלי מפורט בעברית התואם לתוכן הנאמר ולסגנון הציורי של כפר המשנה.\n"
        "החזר mishna_text, prompt ורשימת references."
    )

    resp = _client().messages.parse(
        model=MODEL,
        max_tokens=4000,
        thinking={"type": "adaptive"},
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_msg}],
        output_format=SingleSlotResult,
    )
    result = resp.parsed_output
    if result is None:
        raise RuntimeError("Claude לא החזיר פלט ולידי")
    return {
        "mishna_text": result.mishna_text,
        "prompt": result.prompt,
        "references": result.references,
    }


def repropose_prompt(slot: dict, references: dict, instruction: str | None = None) -> dict:
    """מבקש מ-Claude prompt חדש למשבצת בודדת."""
    user_msg = (
        f"=== אינדקס רפרנסים ===\n{_format_references(references)}\n\n"
        f"טקסט המשבצת (תמלול): {slot.get('text','')}\n"
        f"prompt נוכחי: {slot.get('prompt','')}\n"
    )
    if instruction:
        user_msg += f"הנחיית במאי לשיפור: {instruction}\n"
        user_msg += "\nהחזר prompt ויזואלי מעודכן בעברית ובחירת רפרנסים בפורמט 'ID|שם' מתאימה."

    resp = _client().messages.parse(
        model=MODEL,
        max_tokens=4000,
        thinking={"type": "adaptive"},
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_msg}],
        output_format=RepromptResult,
    )
    result = resp.parsed_output
    if result is None:
        raise RuntimeError("Claude לא החזיר פלט ולידי")
    return {"prompt": result.prompt, "references": result.references}
