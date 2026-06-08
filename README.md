# מערכת משחק כפר המשנה עם תמונת רקע

## 🎮 סקירה כללית

מערכת משחק מודולרית המאפשרת שימוש בתמונות כרקע למפה, עם זיהוי אוטומטי של שבילים לפי צבע והשלמה חכמה של מסלולים.

## 📁 קבצים במערכת

- **`map-engine.js`** - מנוע המפה הניתן לשימוש חוזר
- **`map-config.js`** - קובץ תצורה לתמונה הנוכחית
- **`ai_studio_code_with_image.html`** - המשחק המלא עם תמונת רקע
- **`Generated Image June 08, 2026 - 10_17PM.jpg`** - תמונת הרקע

## ⚠️ בעיית CORS

כאשר פותחים את הקובץ ישירות מה-File System (`file://`), הדפדפן חוסם טעינת תמונות בגלל מדיניות CORS.

### 🔧 פתרונות:

#### פתרון 1: שרת HTTP מקומי (מומלץ)

הפעל שרת HTTP פשוט בתיקייה:

**Python 3:**
```bash
python -m http.server 8000
```

**Python 2:**
```bash
python -m SimpleHTTPServer 8000
```

**Node.js (אם מותקן):**
```bash
npx http-server -p 8000
```

**PHP (אם מותקן):**
```bash
php -S localhost:8000
```

אחר כך פתח בדפדפן:
```
http://localhost:8000/ai_studio_code_with_image.html
```

#### פתרון 2: הטמעת התמונה בקוד (Base64)

אם אתה רוצה שהקובץ יעבוד ללא שרת, אפשר להמיר את התמונה ל-Base64 ולהטמיע אותה בקוד.

**המרה ל-Base64 (Python):**
```python
import base64

with open("Generated Image June 08, 2026 - 10_17PM.jpg", "rb") as image_file:
    encoded = base64.b64encode(image_file.read()).decode()
    print(f"data:image/jpeg;base64,{encoded}")
```

אחר כך עדכן ב-`map-config.js`:
```javascript
imagePath: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...' // הקוד המלא
```

#### פתרון 3: הרחבת דפדפן

פתח את Chrome עם דגל שמאפשר גישה לקבצים מקומיים:

**Windows:**
```bash
chrome.exe --allow-file-access-from-files
```

**Mac:**
```bash
open -a "Google Chrome" --args --allow-file-access-from-files
```

**Linux:**
```bash
google-chrome --allow-file-access-from-files
```

⚠️ **אזהרה:** זה מבטל אבטחה חשובה - השתמש רק לפיתוח!

## 🎯 שימוש במערכת

### 1. הפעלה ראשונית

1. ודא שכל הקבצים באותה תיקייה
2. הפעל שרת HTTP מקומי (ראה למעלה)
3. פתח את `ai_studio_code_with_image.html` בדפדפן

### 2. בקרים

- **חצים / WASD** - תנועה במפה
- **A / Enter** - אינטראקציה (כניסה לבניינים, התחלת קרבות)
- **B / Escape** - ביטול / חזרה
- **L** - מצב Debug (הצגת מפת walkability)
- **R** - מכשיר קשר (עזרה מהקהילה)

### 3. מצב Debug

לחץ על **L** כדי להפעיל מצב Debug:
- **ירוק** = אזורים שניתן ללכת בהם
- **אדום** = אזורים חסומים

זה עוזר לכוונן את זיהוי השבילים.

## 🔧 התאמה לתמונה חדשה

### שלב 1: החלפת התמונה

1. שים את התמונה החדשה בתיקייה
2. עדכן ב-`map-config.js`:
```javascript
imagePath: 'שם_התמונה_החדשה.jpg'
```

### שלב 2: כוונון זיהוי שבילים

1. הפעל את המשחק
2. לחץ **L** להפעלת מצב Debug
3. התבונן באזורים הירוקים והאדומים
4. עדכן ב-`map-config.js` את `pathColors`:

```javascript
pathColors: {
    hueRange: [20, 60],        // גוון (0-360)
    saturationRange: [10, 80], // רוויה (0-100)
    lightnessRange: [40, 85]   // בהירות (0-100)
}
```

**טיפים לכוונון:**
- **שבילים חומים/בז'**: `hueRange: [20, 60]`
- **שבילים אפורים**: `hueRange: [0, 360], saturationRange: [0, 20]`
- **שבילים ירוקים**: `hueRange: [80, 140]`
- **שבילים כחולים**: `hueRange: [180, 240]`

### שלב 3: הוספת שבילים ידניים

אם יש אזורים שלא מזוהים, הוסף אותם ידנית ב-`map-config.js`:

```javascript
manualPaths: [
    // מלבן
    { type: 'rect', x: 100, y: 200, w: 50, h: 200 },
    
    // עיגול
    { type: 'circle', x: 300, y: 400, radius: 50 }
]
```

### שלב 4: מיקום בניינים ודמויות

עדכן ב-`ai_studio_code_with_image.html`:

```javascript
// מיקומי בניינים (בפיקסלים)
const buildingPositions = {
    'building-1': { worldX: 600, worldY: 400 },
    'building-2': { worldX: 1300, worldY: 500 },
    // ...
};

// מיקומי דמויות
const encounters = {
    'wild-1': {
        // ...
        worldX: 800,
        worldY: 600
    },
    // ...
};
```

## ⚙️ אופטימיזציה

### ביצועים איטיים?

הגדל את `tileSize` ב-`map-config.js`:
```javascript
tileSize: 10  // במקום 5
```

### דיוק לא מספיק?

הקטן את `tileSize`:
```javascript
tileSize: 3  // במקום 5
```

### השלמת שבילים

שנה את הפרמטרים:
```javascript
fillGapsSize: 20,      // מילוי חורים גדולים יותר
connectDistance: 40    // חיבור שבילים רחוקים יותר
```

## 🐛 פתרון בעיות נפוצות

### התמונה לא נטענת
- ✅ ודא ששרת HTTP רץ
- ✅ בדוק שנתיב התמונה נכון ב-`map-config.js`
- ✅ פתח את Console (F12) לבדיקת שגיאות

### השחקן לא יכול לזוז
- ✅ הפעל מצב Debug (L) לראות את מפת ה-walkability
- ✅ כוונן את `pathColors` ב-`map-config.js`
- ✅ הוסף שבילים ידניים ב-`manualPaths`

### המשחק איטי
- ✅ הגדל את `tileSize` (למשל 10)
- ✅ הקטן את גודל התמונה
- ✅ הפחת את `connectDistance`

## 📊 מבנה הקוד

```
ImageMapEngine
├── loadImage()           - טעינת התמונה
├── analyzeImage()        - ניתוח וזיהוי שבילים
├── createWalkabilityMap() - יצירת מפת הליכה
├── fillPathGaps()        - מילוי חורים
├── connectNearbyPaths()  - חיבור שבילים
├── isWalkable(x, y)      - בדיקה אם מיקום ניתן להליכה
├── drawDebugOverlay()    - ציור מצב debug
└── toggleDebugMode()     - החלפת מצב debug
```

## 🎨 התאמה אישית

### שינוי מהירות תנועה

ב-`ai_studio_code_with_image.html`:
```javascript
const speed = 5;  // שנה ל-10 לתנועה מהירה יותר
```

### שינוי גודל viewport

ב-`map-config.js`:
```javascript
viewportWidth: 640,   // במקום 480
viewportHeight: 480   // במקום 320
```

### הוספת בניינים חדשים

1. הוסף HTML:
```html
<div class="building" id="building-5">
    <div class="marker">🔹</div>
    🏠<span>בית חדש</span>
</div>
```

2. הוסף מיקום:
```javascript
const buildingPositions = {
    // ...
    'building-5': { worldX: 900, worldY: 700 }
};
```

## 📝 רישיון

קוד זה נוצר עבור פרויקט כפר המשנה וניתן לשימוש חופשי.

## 🤝 תמיכה

לשאלות או בעיות, פתח issue או צור קשר עם המפתח.

---

**נוצר על ידי:** Cline AI Assistant  
**תאריך:** יוני 2026  
**גרסה:** 1.0
