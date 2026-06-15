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
    """סצנה בודדת בתוך דקה (תמונה אחת)."""
    start: str = Field(description="בול זמן התחלה מדויק HH:MM:SS.mmm מתוך ה-SRT")
    end: str = Field(description="בול זמן סיום מדויק HH:MM:SS.mmm")
    mishna_text: str = Field(description="טקסט המשנה המקורי התואם לסצנה הזו (עברית)")
    prompt: str = Field(description="prompt מפורט באנגלית ליצירת תמונה ב-Gemini, התואם לתוכן ולסגנון הציורי של כפר המשנה")
    references: list[str] = Field(default_factory=list, description="רשימת מזהי רפרנס (id) מהאינדקס שיש להיעזר בהם לעקביות דמויות")
    duration: float = Field(description="כמה שניות התמונה נשארת על המסך")


class MinuteSlot(BaseModel):
    """משבצת דקה עם הסצנות (תמונות) שלה."""
    minute_index: int = Field(description="אינדקס הדקה (0, 1, 2...)")
    scenes: list[ProposedScene] = Field(description="רשימת הסצנות (תמונות) בדקה זו")


class MinuteSlotsProposal(BaseModel):
    """הצעת Claude למשבצות דקה."""
    minute_slots: list[MinuteSlot]


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
    "תקבל תמלול מתוזמן (SRT) של פרק, אינדקס רפרנסים של דמויות וסגנון, ויעד קצב תמונות לדקה (images_per_minute). "
    "תפקידך: לכל דקה בפרק, ליצור בדיוק images_per_minute סצנות (תמונות) עם תזמון מדויק. "
    "לכל סצנה תבצע את הפעולות הבאות:\n"
    "1. קבע תזמון מדויק (start/end timestamps מתוך ה-SRT) — הסצנות בדקה חייבות לכסות את כל הדקה ברצף.\n"
    "2. זהה את טקסט המשנה המקורי (בעברית) שמתאים לסצנה זו ושים אותו ב-mishna_text.\n"
    "3. בחר אילו דמויות מתוך אינדקס הרפרנסים (לפי ה-id) צריכות להופיע בסצנה כדי לשמור על עקביות.\n"
    "4. ספק prompt ויזואלי מפורט באנגלית התואם בדיוק לתוכן הנאמר ולסגנון ציורי עקבי.\n"
    "הסצנות חייבות לכסות את ציר הזמן של הדקה ברצף מלא, ללא חפיפות ובלי פערים. "
    "duration = הפרש הזמן של הסצנה (end - start)."
)


def _client() -> anthropic.Anthropic:
    return anthropic.Anthropic()  # קורא ANTHROPIC_API_KEY מהסביבה


def propose_slots(srt_path: str, images_per_minute: float, references: dict, existing_slots: list[dict] | None = None) -> list[dict]:
    """מציע סצנות (תמונות) לכל משבצת דקה, מבוסס על SRT מלא."""
    cues = parse_srt(srt_path)
    if not cues or not existing_slots:
        return existing_slots or []
    
    duration = total_duration(cues)
    full_srt_text = _format_cues(cues)
    
    print(f"[Claude] מעבד {len(existing_slots)} משבצות דקה עם {images_per_minute} תמונות לכל דקה")
    
    # נשלח את כל הדקות ביחד ל-Claude
    user_msg = (
        f"images_per_minute: {int(images_per_minute)}\n"
        f"אורך הפרק: {seconds_to_timestamp(duration)} ({duration:.1f} שניות)\n"
        f"מספר דקות: {len(existing_slots)}\n\n"
        f"=== אינדקס רפרנסים ===\n{_format_references(references)}\n\n"
        f"=== תמלול מתוזמן מלא (SRT) ===\n{full_srt_text}\n\n"
        f"=== משבצות דקה ===\n"
    )
    
    for minute_slot in existing_slots:
        user_msg += (
            f"דקה {minute_slot['minute_index']}: "
            f"{minute_slot['start']} -> {minute_slot['end']}\n"
        )
    
    user_msg += (
        f"\nעבור כל דקה, צור בדיוק {int(images_per_minute)} סצנות עם:\n"
        "- תזמון מדויק (start/end) מה-SRT\n"
        "- mishna_text (עברית)\n"
        "- prompt ויזואלי מפורט (אנגלית)\n"
        "- references מתאימים\n"
        "- duration מדויק\n"
        "הסצנות בכל דקה חייבות לכסות את הדקה במלואה ברצף."
    )
    
    print(f"[Claude] שולח בקשה למודל: {MODEL}")
    print(f"[Claude] אורך הודעה: {len(user_msg)} תווים")
    
    try:
        resp = _client().messages.parse(
            model=MODEL,
            max_tokens=16000,
            thinking={"type": "adaptive"},
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_msg}],
            output_format=MinuteSlotsProposal,
        )
        print(f"[Claude] התקבלה תשובה, stop_reason: {getattr(resp, 'stop_reason', 'N/A')}")
        print(f"[Claude] usage: {getattr(resp, 'usage', 'N/A')}")
    except Exception as e:
        print(f"[Claude ERROR] שגיאה בקריאה ל-API: {type(e).__name__}: {e}")
        raise
    
    proposal = resp.parsed_output
    if proposal is None:
        print(f"[Claude ERROR] parsed_output הוא None")
        raise RuntimeError("Claude לא החזיר פלט ולידי")
    
    print(f"[Claude] התקבלו {len(proposal.minute_slots)} משבצות דקה")
    
    # עדכון המשבצות הקיימות עם הסצנות מ-Claude
    for minute_slot in existing_slots:
        minute_idx = minute_slot['minute_index']
        # מצא את ההצעה של Claude לדקה זו
        claude_minute = next(
            (m for m in proposal.minute_slots if m.minute_index == minute_idx),
            None
        )
        
        if claude_minute:
            # עדכון הסצנות
            updated_scenes = []
            for i, scene in enumerate(claude_minute.scenes, start=1):
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
            minute_slot["scenes"] = updated_scenes
            minute_slot["status"] = "proposed"
    
    return existing_slots


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
