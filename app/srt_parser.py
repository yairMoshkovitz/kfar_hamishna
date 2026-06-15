"""קריאה/כתיבה של קבצי SRT. פרסר עצמאי קצר — אין תלות חיצונית."""
from __future__ import annotations

import re
from dataclasses import dataclass

# 00:00:14,080  או  00:00:14.080
_TIME_RE = re.compile(r"(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})")
_ARROW_RE = re.compile(r"\s*-->\s*")


@dataclass
class SrtCue:
    index: int
    start: float  # שניות
    end: float
    text: str

    @property
    def start_str(self) -> str:
        return seconds_to_timestamp(self.start)

    @property
    def end_str(self) -> str:
        return seconds_to_timestamp(self.end)


def timestamp_to_seconds(ts: str) -> float:
    m = _TIME_RE.search(ts)
    if not m:
        raise ValueError(f"בול זמן לא תקין: {ts!r}")
    h, mn, s, ms = m.groups()
    return int(h) * 3600 + int(mn) * 60 + int(s) + int(ms.ljust(3, "0")) / 1000.0


def seconds_to_timestamp(seconds: float) -> str:
    if seconds < 0:
        seconds = 0.0
    ms = round((seconds - int(seconds)) * 1000)
    total = int(seconds)
    h, rem = divmod(total, 3600)
    mn, s = divmod(rem, 60)
    return f"{h:02d}:{mn:02d}:{s:02d}.{ms:03d}"


def parse_srt(path: str) -> list[SrtCue]:
    """מחזיר רשימת cues מקובץ SRT (תומך BOM וקידוד utf-8)."""
    with open(path, "r", encoding="utf-8-sig") as f:
        content = f.read()

    # נירמול שורות
    content = content.replace("\r\n", "\n").replace("\r", "\n")
    blocks = re.split(r"\n\s*\n", content.strip())

    cues: list[SrtCue] = []
    for block in blocks:
        lines = [ln for ln in block.split("\n") if ln.strip() != ""]
        if not lines:
            continue
        # מצא את שורת הזמנים
        time_line_idx = None
        for i, ln in enumerate(lines):
            if "-->" in ln:
                time_line_idx = i
                break
        if time_line_idx is None:
            continue

        index_part = lines[:time_line_idx]
        try:
            index = int(index_part[0].strip()) if index_part else len(cues) + 1
        except ValueError:
            index = len(cues) + 1

        start_s, end_s = _ARROW_RE.split(lines[time_line_idx], maxsplit=1)
        try:
            start = timestamp_to_seconds(start_s)
            end = timestamp_to_seconds(end_s)
        except ValueError:
            continue

        text = " ".join(ln.strip() for ln in lines[time_line_idx + 1 :]).strip()
        cues.append(SrtCue(index=index, start=start, end=end, text=text))

    return cues


def total_duration(cues: list[SrtCue]) -> float:
    return max((c.end for c in cues), default=0.0)
