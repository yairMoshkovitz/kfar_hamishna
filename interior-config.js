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
    },

    // פסחים פרק א
    'building-psachim-1': {
        id: 'building-psachim-1',
        name: 'פסחים פרק א',
        imagePath: 'בית-מדרש.jpg',

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
                id: 'psachim-1-m1',
                type: 'info',
                worldX: 200,
                worldY: 300,
                icon: '🕯️',
                label: 'משנה א',
                content: {
                    title: 'פסחים פרק א משנה א',
                    text: 'אוֹר לְאַרְבָּעָה עָשָׂר, בּוֹדְקִין אֶת הֶחָמֵץ לְאוֹר הַנֵּר. כָּל מָקוֹם שֶׁאֵין מַכְנִיסִין בּוֹ חָמֵץ, אֵין צָרִיךְ בְּדִיקָה. וּבַמָּה אָמְרוּ שְׁתֵּי שׁוּרוֹת בַּמַּרְתֵּף, מָקוֹם שֶׁמַּכְנִיסִין בּוֹ חָמֵץ. בֵּית שַׁמַּאי אוֹמְרִים, שְׁתֵּי שׁוּרוֹת עַל פְּנֵי כָל הַמַּרְתֵּף. וּבֵית הִלֵּל אוֹמְרִים, שְׁתֵּי שׁוּרוֹת הַחִיצוֹנוֹת שֶׁהֵן הָעֶלְיוֹנוֹת.',
                    imageUrl: 'data/images/פרק א משנה א.png'
                }
            },
            {
                id: 'psachim-1-m2',
                type: 'info',
                worldX: 400,
                worldY: 300,
                icon: '🕯️',
                label: 'משנה ב',
                content: {
                    title: 'פסחים פרק א משנה ב',
                    text: 'אֵין חוֹשְׁשִׁין שֶׁמָּא גֵּרְרָה חוּלְדָּה מִבַּיִת לְבַיִת וּמִמָּקוֹם לְמָקוֹם, דְּאִם כֵּן, מֵחָצֵר לְחָצֵר וּמֵעִיר לְעִיר, אֵין לַדָּבָר סוֹף.',
                    imageUrl: 'data/images/פרק א משנה ב.png'
                }
            },
            {
                id: 'psachim-1-m3',
                type: 'info',
                worldX: 600,
                worldY: 300,
                icon: '🕯️',
                label: 'משנה ג',
                content: {
                    title: 'פסחים פרק א משנה ג',
                    text: 'רַבִּי יְהוּדָה אוֹמֵר, בּוֹדְקִין אוֹר אַרְבָּעָה עָשָׂר, וּבְאַרְבָּעָה עָשָׂר שַׁחֲרִית, וּבִשְׁעַת הַבִּעוּר. וַחֲכָמִים אוֹמְרִים, לֹא בָדַק אוֹר אַרְבָּעָה עָשָׂר, יִבְדֹּק בְּאַרְבָּעָה עָשָׂר. לֹא בָדַק שַׁחֲרִית, יִבְדֹּק בִּשְׁעַת הַבִּעוּר. לֹא בָדַק בִּשְׁעַת הַבִּעוּר, יִבְדֹּק לְאַחַר הַמּוֹעֵד. וּמַה שֶּׁמִּשְׁתַּיֵּר, יַנִּיחֶנּוּ בְּמִסְתָּר, כְּדֵי שֶׁלֹּא יְהֵא צָרִיךְ בְּדִיקָה אַחֲרָיו.',
                    imageUrl: 'data/images/פרק א משנה ג.png'
                }
            },
            {
                id: 'psachim-1-m4',
                type: 'info',
                worldX: 800,
                worldY: 300,
                icon: '🕯️',
                label: 'משנה ד',
                content: {
                    title: 'פסחים פרק א משנה ד',
                    text: 'רַבִּי מֵאִיר אוֹמֵר, אוֹכְלִין כָּל חָמֵשׁ, וְשׂוֹרְפִין בִּתְחִלַּת שֵׁשׁ. וְרַבִּי יְהוּדָה אוֹמֵר, אוֹכְלִין כָּל אַרְבַּע, וְתוֹלִין כָּל חָמֵשׁ, וְשׂוֹרְפִין בִּתְחִלַּת שֵׁשׁ.',
                    imageUrl: 'data/images/פרק א משנה ד.png'
                }
            },
            {
                id: 'psachim-1-m5',
                type: 'info',
                worldX: 1000,
                worldY: 300,
                icon: '🕯️',
                label: 'משנה ה',
                content: {
                    title: 'פסחים פרק א משנה ה',
                    text: 'עוֹד אָמַר רַבִּי יְהוּדָה, שְׁתֵּי חַלּוֹת שֶׁל תּוֹדָה פְּסוּלוֹת מֻנָּחוֹת עַל גַּג הָאִצְטְבָא. כָּל זְמַן שֶׁמֻּנָּחוֹת, כָּל הָעָם אוֹכְלִין. נִטְּלָה אַחַת, תּוֹלִין, לֹא אוֹכְלִין וְלֹא שׂוֹרְפִין. נִטְּלוּ שְׁתֵּיהֶן, הִתְחִילוּ כָל הָעָם שׂוֹרְפִין. רַבָּן גַּמְלִיאֵל אוֹמֵר, חֻלִּין נֶאֱכָלִין כָּל חָמֵשׁ, וּתְרוּמָה כָּל שֵׁשׁ, וְשׂוֹרְפִין בִּתְחִלַּת שֶׁבַע.',
                    imageUrl: 'data/images/פרק א משנה ה.png'
                }
            },
            {
                id: 'psachim-1-m67',
                type: 'info',
                worldX: 300,
                worldY: 480,
                icon: '🕯️',
                label: 'משנה ו-ז',
                content: {
                    title: 'פסחים פרק א משנה ו-ז',
                    text: 'חֲנִינָא סְגַן הַכֹּהֲנִים אוֹמֵר, מִימֵיהֶם שֶׁל כֹּהֲנִים לֹא נִמְנְעוּ מִלִּשְׂרֹף אֶת הַבָּשָׂר שֶׁנִּטְמָא בִּוְלַד הַטֻּמְאָה עִם הַבָּשָׂר שֶׁנִּטְמָא בְּאַב הַטֻּמְאָה...',
                    imageUrl: 'data/images/פרק א משנה ו ז.png'
                }
            },
            {
                id: 'psachim-podcast-2-1',
                type: 'podcast',
                worldX: 550,
                worldY: 480,
                icon: '🎧',
                label: 'פודקאסט ב-א',
                content: {
                    title: 'פסחים פרק ב משנה א',
                    description: 'כל שעה שמותר לאכול, מאכיל לבהמה לחיה ולעופות ולוקח ממנו פרוטה לשכרו...',
                    audioUrl: 'data/podcasts/psachim/perek-2/פסחים-ב-א.mp3',
                    duration: '01:54',
                    imageUrl: 'data/images/דמויות כפר המשנה הדור הישן (4).jpeg'
                }
            },
            {
                id: 'psachim-podcast-2-2',
                type: 'podcast',
                worldX: 750,
                worldY: 480,
                icon: '🎧',
                label: 'פודקאסט ב-בג',
                content: {
                    title: 'פסחים פרק ב משנה ב-ג',
                    description: 'חמץ של נכרי שעבר עליו הפסח מותר בהנאה ושל ישראל אסור...',
                    audioUrl: 'data/podcasts/psachim/perek-2/פסחים-ב-בג.mp3',
                    duration: '02:30',
                    imageUrl: 'data/images/דמויות כפר המשנה הדור הישן (5).jpeg'
                }
            }
        ]
    },

    // פסחים פרק י
    'building-psachim-10': {
        id: 'building-psachim-10',
        name: 'פסחים פרק י',
        imagePath: 'בית-פרטי1.jpg',

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
                id: 'psachim-10-m1',
                type: 'info',
                worldX: 300,
                worldY: 400,
                icon: '🍷',
                label: 'משנה א',
                content: {
                    title: 'פסחים פרק י משנה א',
                    text: 'עַרְבֵי פְסָחִים סָמוּךְ לַמִּנְחָה, לֹא יֹאכַל אָדָם עַד שֶׁתֶּחְשַׁךְ. וַאֲפִילוּ עָנִי שֶׁבְּיִשְׂרָאֵל לֹא יֹאכַל עַד שֶׁיָּסֵב. וְלֹא יִפְחֲתוּ לוֹ מֵאַרְבַּע כּוֹסוֹת שֶׁל יַיִן, וַאֲפִילוּ מִן הַתַּמְחוּי.',
                    imageUrl: 'data/images/פרק י משנה א.png'
                }
            },
            {
                id: 'psachim-podcast-3-1',
                type: 'podcast',
                worldX: 600,
                worldY: 400,
                icon: '🎧',
                label: 'פודקאסט ג-א',
                content: {
                    title: 'פסחים פרק ג משנה א',
                    description: 'אלו עוברין בפסח: כותח הבבלי ושכר המדי וחומץ האדומי...',
                    audioUrl: 'data/podcasts/psachim/perek-3/פסחים-ג-א.mp3',
                    duration: '02:08',
                    imageUrl: 'data/images/דמויות כפר המשנה הדור הישן (1).jpeg'
                }
            },
            {
                id: 'psachim-podcast-3-2',
                type: 'podcast',
                worldX: 850,
                worldY: 400,
                icon: '🎧',
                label: 'פודקאסט ג-ב',
                content: {
                    title: 'פסחים פרק ג משנה ב',
                    description: 'בצק שבסידקי החול אם יש כזית חייב לבער...',
                    audioUrl: 'data/podcasts/psachim/perek-3/פסחים-ג-ב.mp3',
                    duration: '01:45',
                    imageUrl: 'data/images/דמויות כפר המשנה הדור הישן (2).jpeg'
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
