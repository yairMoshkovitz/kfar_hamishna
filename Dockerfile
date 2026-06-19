# Dockerfile להרצת אפליקציית ה-FastAPI (Studio) ב-Railway
FROM python:3.11-slim

# התקנת תלויות מערכת אם נדרש (למשל עבור עיבוד וידאו/תמונות)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libsm6 \
    libxext6 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# העתקת דרישות והתקנה
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# העתקת שאר קבצי האפליקציה
COPY . .

# פורט ברירת מחדל להרצה. Railway מזריקה PORT באופן אוטומטי.
ENV PORT=8080

# הרצת השרת באמצעות uvicorn
# שימוש ב-0.0.0.0 כדי לאפשר גישה חיצונית בתוך הקונטיינר
CMD uvicorn app.main:app --host 0.0.0.0 --port $PORT
