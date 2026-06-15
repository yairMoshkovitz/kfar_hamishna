# כפר המשנה — Studio 🎬

ממשק במאי שהופך פרק פודקאסט עלילתי לווידאו מצויר מסונכרן: תמלול → הצעת Claude (מתי תמונה + prompt + רפרנסים) → אישור/עריכת במאי → יצירת תמונות ב-Gemini (עם עקביות דמויות) → אישור → הרכבת וידאו ב-ffmpeg.

## דרישות מקדימות
- Python 3.11+
- `ffmpeg` ב-PATH (כבר מותקן בסביבה זו)
- מפתחות API: Anthropic (Claude) ו-Gemini

## התקנה
```bash
pip install -r requirements.txt
cp .env.example .env        # ערוך והכנס מפתחות ANTHROPIC_API_KEY ו-GEMINI_API_KEY
```

## הרצה
```bash
uvicorn app.main:app --reload
```
פתח בדפדפן: http://localhost:8000

## זרימת עבודה בממשק
1. **בחר משנה** מהרשימה למעלה (כרגע יש SRT ל"פסחים-ג-א").
2. קבע **תמונות לדקה** (ברירת מחדל 4) ולחץ **הרץ הצעת Claude** — נוצרות משבצות עם זמנים, prompts ורפרנסים.
3. לכל משבצת: שמע את קטע האודיו, תקן תמלול/prompt, ערוך רפרנסים, או לחץ **בקש prompt מחדש**. שמור עריכות.
4. לחץ **צור תמונה** (או **צור כל המאושרים**). התמונה נוצרת ב-Gemini עם תמונות הרפרנס לעקביות.
5. **אשר** תמונות. תמונה לא מוצאת חן? ערוך prompt וצור מחדש.
6. **הרכב וידאו** — ffmpeg מסנכרן את התמונות עם האודיו לפי הזמנים ומפיק `output.mp4`.

## מבנה
- `app/` — backend (FastAPI) + frontend סטטי תחת `app/static/`
  - `claude_brain.py` — Claude API (`claude-opus-4-8`, structured output)
  - `gemini_images.py` — Gemini image generation (`GEMINI_IMAGE_MODEL`)
  - `srt_parser.py`, `project_store.py`, `video_builder.py`
- `data/podcasts/...` — אודיו + SRT (נכסים גולמיים, לא משתנים)
- `data/references/index.json` — אינדקס דמויות/סגנון (ערוך תיאורים לפי הצורך)
- `data/studio/<mishna_id>/` — תוצרי העריכה: `project.json`, תמונות, `output.mp4`

## הגדרות (אופציונלי, ב-.env)
- `CLAUDE_MODEL` (ברירת מחדל `claude-opus-4-8`)
- `GEMINI_IMAGE_MODEL` (ברירת מחדל `gemini-3-pro-image-preview`; אפשר `gemini-2.5-flash-image`)

## הערות
- הקוד הקיים ברפו (מנוע משחק-מפה: `main.html`, `map-engine.js`, `interior-engine.js`) אינו קשור ל-Studio ולא נגעתי בו.
- מצב כל משבצת נשמר ב-`project.json` — אפשר לסגור ולחזור בלי לאבד עבודה.
