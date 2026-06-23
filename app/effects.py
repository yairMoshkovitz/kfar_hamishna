"""קטלוג אפקטים לתמונות + בניית מחרוזת פילטר zoompan של FFmpeg.

כל אפקט הופך תמונה סטטית לקליפ עם תנועה קולנועית (Ken Burns).
קלוד בוחר אפקט ועוצמה לכל סצנה; כאן ממירים את הבחירה לפילטר ffmpeg.
"""
from __future__ import annotations

WIDTH = 1920
HEIGHT = 1080

# רשימת האפקטים החוקיים בקטלוג
EFFECTS = (
    "static",
    "zoom_in",
    "zoom_out",
    "pan_left",
    "pan_right",
    "pan_up",
    "pan_down",
    "ken_burns",
)

INTENSITIES = ("subtle", "medium", "strong")

DEFAULT_EFFECT = "ken_burns"
DEFAULT_INTENSITY = "medium"

# קצב זום לפריים (כמה ה-zoom גדל בכל פריים) לפי עוצמה
_ZOOM_RATE = {
    "subtle": 0.0006,
    "medium": 0.0012,
    "strong": 0.0022,
}

# זום מקסימלי (יעד) לפי עוצמה — קובע כמה התמונה "מתקרבת" בסך הכל
_ZOOM_MAX = {
    "subtle": 1.08,
    "medium": 1.18,
    "strong": 1.30,
}

# זום קבוע קל לפאן (כדי שיהיה מרווח לתזוזה בלי לחשוף שוליים שחורים)
_PAN_ZOOM = {
    "subtle": 1.10,
    "medium": 1.15,
    "strong": 1.22,
}


def normalize(effect: str | None, intensity: str | None) -> tuple[str, str]:
    """מנקה ערכים — מחזיר ברירות מחדל אם לא חוקי."""
    e = (effect or DEFAULT_EFFECT).strip().lower()
    if e not in EFFECTS:
        e = DEFAULT_EFFECT
    i = (intensity or DEFAULT_INTENSITY).strip().lower()
    if i not in INTENSITIES:
        i = DEFAULT_INTENSITY
    return e, i


def build_vf(effect: str | None, intensity: str | None, duration: float, fps: int = 25) -> str:
    """מחזיר מחרוזת -vf מלאה לקליפ של תמונה בודדת.

    לאפקט static מחזיר רק scale/pad (זהה להתנהגות הישנה).
    לשאר — מגדיל פי 2 (לחלקות), מפעיל zoompan, ואז מתאים ל-1920x1080.
    """
    effect, intensity = normalize(effect, intensity)

    base_scale_pad = (
        f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=decrease,"
        f"pad={WIDTH}:{HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p"
    )

    frames = max(1, round(duration * fps))

    if effect == "static":
        # zoompan עם זום קבוע 1.0 — אין תנועה, אך מייצר בדיוק frames פריימים
        # כך שאורך הקליפ מדויק (תמונה בודדת בלי zoompan הייתה פריים אחד בלבד).
        zp_static = (
            f"zoompan=z='1':x='0':y='0':d={frames}:s={WIDTH}x{HEIGHT}:fps={fps}"
        )
        return f"{base_scale_pad},{zp_static}"

    zp = _zoompan_expr(effect, intensity, frames, fps)

    # הגדלה מקדימה פי 2 כדי שהזום/פאן יהיה חלק ולא מפוקסל,
    # ואז zoompan שמחזיר ל-WIDTHxHEIGHT, ולבסוף format לתאימות mp4.
    return (
        f"scale={WIDTH*2}:{HEIGHT*2}:force_original_aspect_ratio=increase,"
        f"crop={WIDTH*2}:{HEIGHT*2},"
        f"{zp},"
        f"setsar=1,format=yuv420p"
    )


def _zoompan_expr(effect: str, intensity: str, frames: int, fps: int) -> str:
    """בונה את ביטוי ה-zoompan עצמו (בלי scale/pad מסביב)."""
    s = f"s={WIDTH}x{HEIGHT}"
    d = f"d={frames}"
    fps_arg = f"fps={fps}"

    if effect in ("zoom_in", "zoom_out"):
        rate = _ZOOM_RATE[intensity]
        zmax = _ZOOM_MAX[intensity]
        if effect == "zoom_in":
            z = f"z='min(zoom+{rate:.5f},{zmax})'"
        else:
            # מתחילים מזום מקסימלי ופוחתים בהדרגה חזרה ל-1.0
            z = f"z='if(eq(on,0),{zmax},max(zoom-{rate:.5f},1.0))'"
        # ממרכזים את נקודת הזום
        x = "x='iw/2-(iw/zoom/2)'"
        y = "y='ih/2-(ih/zoom/2)'"
        return f"zoompan={z}:{x}:{y}:{d}:{s}:{fps_arg}"

    if effect.startswith("pan_"):
        zoom = _PAN_ZOOM[intensity]
        z = f"z='{zoom}'"
        # התזוזה מתפרסת על כל הפריימים (on/frames מ-0 ל-1)
        prog = f"(on/{max(1, frames - 1)})"
        # טווח התזוזה האפשרי בציר נתון בזום הקבוע
        x_center = "iw/2-(iw/zoom/2)"
        y_center = "ih/2-(ih/zoom/2)"
        max_x = "(iw-iw/zoom)"
        max_y = "(ih-ih/zoom)"
        if effect == "pan_left":
            x = f"x='{max_x}*(1-{prog})'"
            y = f"y='{y_center}'"
        elif effect == "pan_right":
            x = f"x='{max_x}*{prog}'"
            y = f"y='{y_center}'"
        elif effect == "pan_up":
            x = f"x='{x_center}'"
            y = f"y='{max_y}*(1-{prog})'"
        else:  # pan_down
            x = f"x='{x_center}'"
            y = f"y='{max_y}*{prog}'"
        return f"zoompan={z}:{x}:{y}:{d}:{s}:{fps_arg}"

    # ken_burns — זום הדרגתי + תזוזה אלכסונית
    rate = _ZOOM_RATE[intensity]
    zmax = _ZOOM_MAX[intensity]
    prog = f"(on/{max(1, frames - 1)})"
    z = f"z='min(zoom+{rate:.5f},{zmax})'"
    x = f"x='(iw-iw/zoom)*{prog}'"
    y = f"y='(ih-ih/zoom)*{prog}'"
    return f"zoompan={z}:{x}:{y}:{d}:{s}:{fps_arg}"
