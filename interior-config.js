/**
 * תצורת מסכים פנימיים - בניינים שאפשר להיכנס אליהם
 * כל בניין יכול להכיל נקודות אינטראקציה שונות
 *
 * ⚠️ גודל התמונות האמיתי הוא 1195×896. כל הקואורדינטות חייבות להיות בתוך הגבולות האלה.
 * הערה: זיהוי שבילים (walkability) מושהה כרגע - כל שטח הבניין ניתן להליכה.
 */

const interiorConfig = {
    // בית כנסת
    'building-1': {
        id: 'building-1',
        name: 'בית כנסת',
        imagePath: 'בית-מדרש.jpg', // זמנית משתמש באותה תמונה או תמונה חלופית אם יש, אך לפחות שייפתח ולא יקרוס

        imageWidth: 1195,
        imageHeight: 896,

        playerStartX: 597,
        playerStartY: 650,

        exitPoint: {
            worldX: 597,
            worldY: 850,
            radius: 60,
            label: 'יציאה'
        },

        pathColors: {
            hueRange: [0, 360],
            saturationRange: [0, 100],
            lightnessRange: [30, 90]
        },

        interactionPoints: [
            {
                id: 'syn-sefer-1',
                type: 'info',
                worldX: 597,
                worldY: 300,
                icon: '🕍',
                label: 'ארון קודש',
                content: {
                    title: 'ספר תורה קהילתי',
                    text: 'ברוכים הבאים לבית הכנסת של כפר המשנה.\nזמני תפילות ושעורי תורה מתקיימים כאן יום-יום.'
                }
            }
        ]
    },

    // בית מדרש
    'building-2': {
        id: 'building-2',
        name: 'בית מדרש',
        imagePath: 'בית-מדרש.jpg',

        // הגדרות מפה
        imageWidth: 1195,
        imageHeight: 896,

        // מיקום התחלתי של השחקן בכניסה לבניין
        playerStartX: 597,
        playerStartY: 650,

        // נקודת יציאה (חזרה למפה הראשית)
        exitPoint: {
            worldX: 597,
            worldY: 850,
            radius: 60,
            label: 'יציאה'
        },

        // זיהוי שבילים (אם יש רצפה שאפשר ללכת עליה)
        pathColors: {
            hueRange: [0, 360],        // כל הצבעים
            saturationRange: [0, 100],
            lightnessRange: [30, 90]
        },

        // נקודות אינטראקציה בבניין
        interactionPoints: [
            {
                id: 'bm-sefer-1',
                type: 'game',  // משחק/חידון
                worldX: 350,
                worldY: 400,
                icon: '📚',
                label: 'ספר תורה',
                content: {
                    sprite: '📖',
                    question: 'מהו הזמן האחרון לקריאת שמע של שחרית?',
                    options: ['סוף שעה 3', 'סוף שעה 4', 'חצות', 'עד הערב'],
                    correct: 1
                }
            },
            {
                id: 'bm-podcast-1',
                type: 'podcast',  // פודקאסט
                worldX: 850,
                worldY: 400,
                icon: '🎧',
                label: 'שיעור',
                content: {
                    title: 'שיעור בהלכות שבת',
                    description: 'הרב מסביר על דיני הדלקת נרות',
                    audioUrl: '',  // כאן תוכל להוסיף קישור לקובץ אודיו
                    duration: '15:30'
                }
            },
            {
                id: 'bm-info-1',
                type: 'info',  // מידע/טקסט
                worldX: 597,
                worldY: 250,
                icon: '📜',
                label: 'לוח מודעות',
                content: {
                    title: 'זמני התפילות',
                    text: `שחרית: 6:30
מנחה: 13:00
ערבית: 19:30

שיעורים:
- דף יומי: 7:00
- הלכה: 20:00`
                }
            }
        ]
    },

    // בית פרטי
    'building-private': {
        id: 'building-private',
        name: 'בית פרטי',
        imagePath: 'בית-פרטי1.jpg',

        // הגדרות מפה
        imageWidth: 1195,
        imageHeight: 896,

        // מיקום התחלתי של השחקן בכניסה לבניין
        playerStartX: 597,
        playerStartY: 650,

        // נקודת יציאה (חזרה למפה הראשית)
        exitPoint: {
            worldX: 597,
            worldY: 850,
            radius: 60,
            label: 'יציאה'
        },

        // זיהוי שבילים (אם יש רצפה שאפשר ללכת עליה)
        pathColors: {
            hueRange: [0, 360],        // כל הצבעים
            saturationRange: [0, 100],
            lightnessRange: [30, 90]
        },

        interactionPoints: [
            {
                id: 'home-game-1',
                type: 'game',
                worldX: 350,
                worldY: 450,
                icon: '🕯️',
                label: 'נרות שבת',
                content: {
                    sprite: '🕯️',
                    question: 'מתי מדליקים נרות שבת?',
                    options: ['18 דקות לפני השקיעה', '40 דקות לפני השקיעה', 'בשקיעה', 'אחרי השקיעה'],
                    correct: 0
                }
            },
            {
                id: 'home-info-1',
                type: 'info',
                worldX: 850,
                worldY: 450,
                icon: '📖',
                label: 'ספר',
                content: {
                    title: 'ספר המידות',
                    text: `"איזהו חכם? הלומד מכל אדם"

הספר מלמד אותנו על מידות טובות:
- ענוה
- סבלנות
- אהבת חינם
- כבוד הבריות`
                }
            },
            {
                id: 'home-podcast-1',
                type: 'podcast',
                worldX: 597,
                worldY: 280,
                icon: '📻',
                label: 'רדיו',
                content: {
                    title: 'סיפורי צדיקים',
                    description: 'סיפור על הבעל שם טוב',
                    audioUrl: '',
                    duration: '10:00'
                }
            }
        ]
    }
};

// פונקציה לקבלת תצורת בניין לפי ID
function getInteriorConfig(buildingId) {
    return interiorConfig[buildingId] || null;
}

// רשימת כל הבניינים שאפשר להיכנס אליהם
function getEnterableBuildings() {
    return Object.keys(interiorConfig);
}
