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
    prompt: str = Field(description="prompt מפורט באנגלית ליצירת תמונה ב-Gemini, התואם לתוכן ולסגנון הציורי של כפר המשנה")
    references: list[str] = Field(default_factory=list, description="רשימת מזהי רפרנס (id) מהאינדקס שיש להיעזר בהם לעקביות דמויות")
    duration: float = Field(description="כמה שניות התמונה נשארת על המסך")


class ProjectProposal(BaseModel):
    """הצעת Claude לכלל הסצנות בפרויקט."""
    scenes: list[ProposedScene] = Field(description="רשימת כל הסצנות (תמונות) של הפרק מתחילתו ועד סופו ברצף")


class RepromptResult(BaseModel):
    prompt: str
    references: list[str] = Field(default_factory=list)


class SingleSlotResult(BaseModel):
    mishna_text: str = Field(default="", description="טקסט המשנה המקורי התואם לקטע הזה (עברית)")
    prompt: str = Field(description="prompt מפורט באנגלית ליצירת תמונה ב-Gemini")
    references: list[str] = Field(default_factory=list, description="רשימת מזהי רפרנס (id) מהאינדקס")


# ---------- בניית קלט ----------
def _format_cues(cues: list[SrtCue]) -> str:
    return "\n".join(
        f"[{seconds_to_timestamp(c.start)} --> {seconds_to_timestamp(c.end)}] {c.text}"
        for c in cues
    )


def _format_references(refs: dict) -> str:
    lines = []
    for r in refs.get("references", []):
        lines.append(f"- id: {r['id']} | {r.get('name','')} | {r.get('category','')} | {r.get('description','')}")
    return "\n".join(lines) if lines else "(אין רפרנסים זמינים)"


SYSTEM_PROMPT = (
    "אתה במאי ויזואלי לסדרת פודקאסט עלילתית בשם 'כפר המשנה', שמלמדת משנה דרך דמויות מצוירות. "
    "תקבל תמלול מתוזמן (SRT) של פרק, עלילה (אם קיימת), אינדקס רפרנסים של דמויות וסגנון, ויעד קצב תמונות לדקה (images_per_minute). "
    "תפקידך: לחלק את התמלול לסצנות רציפות. אתה רשאי לקבוע את אורכה של כל סצנה (החל ממספר שניות ועד למעלה מדקה), "
    "בהתאם לקצב ההתרחשויות בעלילה ובמשנה. בממוצע נשאף ל-images_per_minute סצנות לדקה, אך החלוקה צריכה להיות טבעית לעלילה. "
    "לכל סצנה תבצע את הפעולות הבאות:\n"
    "1. קבע תזמון מדויק (start/end timestamps מתוך ה-SRT) — הסצנות חייבות לכסות את כל זמן הוידאו ברצף.\n"
    "2. זהה את טקסט המשנה המקורי (בעברית) שמתאים לסצנה זו ושים אותו ב-mishna_text.\n"
    "3. בחר אילו דמויות מתוך אינדקס הרפרנסים (לפי ה-id) צריכות להופיע בסצנה. אל תמציא תיאורים חדשים לדמויות שקיימות ברפרנסים! "
    "אם בחרת רפרנס קיים, עליך לשלב את תיאור הרפרנס בדיוק כפי שהוא מופיע באינדקס לתוך ה-prompt הוויזואלי.\n"
    "4. ספק prompt ויזואלי מפורט באנגלית התואם בדיוק לתוכן הנאמר, העלילה, ולסגנון ציורי עקבי, כולל שילוב תיאורי הדמויות מהרפרנסים.\n"
    "הסצנות חייבות לכסות את ציר הזמן של הפרק ברצף מלא מתחילתו ועד סופו, ללא חפיפות ובלי פערים. "
    "duration = הפרש הזמן של הסצנה (end - start)."
)


def _client() -> anthropic.Anthropic:
    import httpx
    # יציאה דרך SOCKS5 proxy כמו במחולל תמונות
    proxy_url = "socks5h://127.0.0.1:1080"
    
    # Bypass SSL verification locally in case of certificate issues
    http_client = httpx.Client(
        verify=False,
        proxy=proxy_url
    )
    return anthropic.Anthropic(http_client=http_client)  # קורא ANTHROPIC_API_KEY מהסביבה


def preview_prompt(srt_path: str, images_per_minute: float, references: dict, plot_path: str | None = None, director_instructions: str = "") -> str:
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
                
    user_msg = (
        f"images_per_minute (יעד ממוצע): {int(images_per_minute)}\n"
        f"אורך הפרק: {seconds_to_timestamp(duration)} ({duration:.1f} שניות)\n\n"
    )
    
    if director_instructions:
        user_msg += f"=== הוראות במאי מיוחדות ===\n{director_instructions}\n\n"
        
    user_msg += (
        f"=== עלילה ===\n{plot_text}\n\n"
        f"=== אינדקס רפרנסים ===\n{_format_references(references)}\n\n"
        f"=== תמלול מתוזמן מלא (SRT) ===\n{full_srt_text}\n\n"
    )
    
    return f"--- SYSTEM PROMPT ---\n{SYSTEM_PROMPT}\n\n--- USER MESSAGE ---\n{user_msg}"

def propose_slots(srt_path: str, images_per_minute: float, references: dict, existing_slots: list[dict] | None = None, plot_path: str | None = None, director_instructions: str = "", custom_prompt: str | None = None) -> list[dict]:
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
        user_msg = (
            f"images_per_minute (יעד ממוצע): {int(images_per_minute)}\n"
            f"אורך הפרק: {seconds_to_timestamp(duration)} ({duration:.1f} שניות)\n\n"
        )
        if director_instructions:
            user_msg += f"=== הוראות במאי מיוחדות ===\n{director_instructions}\n\n"
            
        user_msg += (
            f"=== עלילה ===\n{plot_text}\n\n"
            f"=== אינדקס רפרנסים ===\n{_format_references(references)}\n\n"
            f"=== תמלול מתוזמן מלא (SRT) ===\n{full_srt_text}\n\n"
        )
    
    print(f"[Claude] שולח בקשה למודל: {MODEL}")
    print(f"[Claude] אורך הודעה: {len(user_msg)} תווים")
    
    try:
        # במידה ומדובר ב-Sonnet 3.5 ומעלה, thinking יכול לקחת זמן רב מאוד או להיכשל על timeout
        # ננסה להשתמש ב-thinking רק אם זה Opus, או פשוט לבטל אותו ליצירה מהירה של סצנות
        kwargs = {
            "model": MODEL,
            "max_tokens": 16000,
            "system": SYSTEM_PROMPT,
            "messages": [{"role": "user", "content": user_msg}],
            "output_format": ProjectProposal,
        }
        
        # אם המודל הוא Opus, נשאיר thinking. אם Sonnet, נוריד כדי שיהיה מהיר
        if "opus" in MODEL.lower():
            kwargs["thinking"] = {"type": "adaptive"}
            
        resp = _client().messages.parse(**kwargs)
        print(f"[Claude] התקבלה תשובה, stop_reason: {getattr(resp, 'stop_reason', 'N/A')}")
        print(f"[Claude] usage: {getattr(resp, 'usage', 'N/A')}")
    except Exception as e:
        print(f"[Claude ERROR] שגיאה בקריאה ל-API: {type(e).__name__}: {e}")
        raise
    
    proposal = resp.parsed_output
    if proposal is None:
        print(f"[Claude ERROR] parsed_output הוא None")
        raise RuntimeError("Claude לא החזיר פלט ולידי")
    
    print(f"[Claude] התקבלו {len(proposal.scenes)} סצנות דינמיות מ-Claude")
    
    # בניית משבצת אחת לכל הפרויקט (כי UI הקיים שלנו מצפה למבנה של slots שבתוכו scenes)
    # אנחנו נארוז את כל הסצנות בתוך משבצת אחת בשם "הפרק המלא", או שנייצר מבנה חדש.
    # הממשק (app.js) עדיין מצפה ל-project.slots -> slot.scenes.
    # נשים את הכל תחת משבצת אחת גדולה שנקראת "כל הסצנות".
    
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
        "status": "proposed",
    }]
    
    return slots


def propose_single_slot(slot: dict, references: dict) -> dict:
    """מציע mishna_text, prompt ורפרנסים למשבצת בודדת — לשימוש בהזרמה (streaming) פר-משבצת."""
    user_msg = (
        f"=== אינדקס רפרנסים ===\n{_format_references(references)}\n\n"
        f"זמן המשבצת: {slot.get('start','')} -> {slot.get('end','')}\n"
        f"תמלול הקטע (SRT): {slot.get('text','')}\n\n"
        "עבור משבצת בודדת זו:\n"
        "1. זהה את טקסט המשנה המקורי (עברית) התואם לקטע — שים ב-mishna_text.\n"
        "2. בחר רפרנסים (ids) מתאימים לשמירת עקביות דמויות/סגנון.\n"
        "3. ספק prompt ויזואלי מפורט באנגלית התואם לתוכן הנאמר ולסגנון הציורי של כפר המשנה.\n"
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
    """מבקש מ-Claude prompt חדש למשבצת בודדת (אחרי שהבמאי תיקן תמלול או רוצה כיוון אחר)."""
    user_msg = (
        f"=== אינדקס רפרנסים ===\n{_format_references(references)}\n\n"
        f"טקסט המשבצת (תמלול): {slot.get('text','')}\n"
        f"prompt נוכחי: {slot.get('prompt','')}\n"
    )
    if instruction:
        user_msg += f"הנחיית במאי לשיפור: {instruction}\n"
    user_msg += "\nהחזר prompt ויזואלי מעודכן באנגלית ובחירת רפרנסים (ids) מתאימה."

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
