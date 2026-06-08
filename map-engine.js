/**
 * ImageMapEngine - מנוע מפה מבוסס תמונה עם זיהוי שבילים
 * ניתן לשימוש חוזר עם תמונות שונות
 * 
 * @author Cline AI Assistant
 * @version 1.0
 */

class ImageMapEngine {
    constructor(config) {
        this.config = {
            imagePath: config.imagePath || '',
            imageWidth: config.imageWidth || 1920,
            imageHeight: config.imageHeight || 1440,
            viewportWidth: config.viewportWidth || 480,
            viewportHeight: config.viewportHeight || 320,
            
            // זיהוי צבעי שבילים (HSL)
            pathColors: config.pathColors || {
                hueRange: [20, 60],           // חום/צהוב/בז'
                saturationRange: [10, 80],
                lightnessRange: [40, 85]
            },
            
            // השלמת שבילים
            fillGapsSize: config.fillGapsSize || 15,
            connectDistance: config.connectDistance || 30,
            
            // שבילים ידניים
            manualPaths: config.manualPaths || [],
            
            // גודל טייל לאופטימיזציה
            tileSize: config.tileSize || 5
        };
        
        this.image = null;
        this.imageData = null;
        this.walkabilityMap = null;
        this.debugMode = false;
        this.isReady = false;
    }
    
    /**
     * טעינת התמונה וניתוח
     */
    async loadImage() {
        return new Promise((resolve, reject) => {
            this.image = new Image();
            this.image.crossOrigin = "anonymous";
            
            this.image.onload = () => {
                console.log('✅ תמונה נטענה בהצלחה');
                this.analyzeImage();
                this.isReady = true;
                resolve();
            };
            
            this.image.onerror = (err) => {
                console.error('❌ שגיאה בטעינת התמונה:', err);
                reject(err);
            };
            
            this.image.src = this.config.imagePath;
        });
    }
    
    /**
     * ניתוח התמונה וזיהוי שבילים
     */
    analyzeImage() {
        console.log('🔍 מנתח תמונה...');
        
        // יצירת canvas נסתר
        const canvas = document.createElement('canvas');
        canvas.width = this.image.width;
        canvas.height = this.image.height;
        const ctx = canvas.getContext('2d');
        
        // ציור התמונה
        ctx.drawImage(this.image, 0, 0);
        
        // קריאת פיקסלים
        this.imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        
        // יצירת מפת walkability
        this.createWalkabilityMap();
        
        // השלמת שבילים
        this.fillPathGaps();
        this.connectNearbyPaths();
        
        console.log('✅ ניתוח הושלם');
    }
    
    /**
     * יצירת מפת walkability מהתמונה
     */
    createWalkabilityMap() {
        const width = this.image.width;
        const height = this.image.height;
        const tileSize = this.config.tileSize;
        
        const tilesX = Math.ceil(width / tileSize);
        const tilesY = Math.ceil(height / tileSize);
        
        this.walkabilityMap = [];
        
        for (let ty = 0; ty < tilesY; ty++) {
            this.walkabilityMap[ty] = [];
            for (let tx = 0; tx < tilesX; tx++) {
                // בדיקת הטייל - אם רוב הפיקסלים הם שביל
                let pathPixels = 0;
                let totalPixels = 0;
                
                for (let py = 0; py < tileSize; py++) {
                    for (let px = 0; px < tileSize; px++) {
                        const x = tx * tileSize + px;
                        const y = ty * tileSize + py;
                        
                        if (x < width && y < height) {
                            totalPixels++;
                            if (this.isPathColor(x, y)) {
                                pathPixels++;
                            }
                        }
                    }
                }
                
                // אם יותר מ-50% מהפיקסלים הם שביל
                this.walkabilityMap[ty][tx] = (pathPixels / totalPixels) > 0.5;
            }
        }
    }
    
    /**
     * בדיקה אם פיקסל הוא צבע שביל
     */
    isPathColor(x, y) {
        const index = (y * this.image.width + x) * 4;
        const r = this.imageData.data[index];
        const g = this.imageData.data[index + 1];
        const b = this.imageData.data[index + 2];
        
        // המרה ל-HSL
        const hsl = this.rgbToHsl(r, g, b);
        
        const [hMin, hMax] = this.config.pathColors.hueRange;
        const [sMin, sMax] = this.config.pathColors.saturationRange;
        const [lMin, lMax] = this.config.pathColors.lightnessRange;
        
        return (
            hsl.h >= hMin && hsl.h <= hMax &&
            hsl.s >= sMin && hsl.s <= sMax &&
            hsl.l >= lMin && hsl.l <= lMax
        );
    }
    
    /**
     * המרת RGB ל-HSL
     */
    rgbToHsl(r, g, b) {
        r /= 255;
        g /= 255;
        b /= 255;
        
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        let h, s, l = (max + min) / 2;
        
        if (max === min) {
            h = s = 0;
        } else {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            
            switch (max) {
                case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
                case g: h = ((b - r) / d + 2) / 6; break;
                case b: h = ((r - g) / d + 4) / 6; break;
            }
        }
        
        return {
            h: Math.round(h * 360),
            s: Math.round(s * 100),
            l: Math.round(l * 100)
        };
    }
    
    /**
     * מילוי חורים קטנים בשבילים
     */
    fillPathGaps() {
        const maxGapSize = Math.ceil(this.config.fillGapsSize / this.config.tileSize);
        const tilesX = this.walkabilityMap[0].length;
        const tilesY = this.walkabilityMap.length;
        
        for (let ty = 1; ty < tilesY - 1; ty++) {
            for (let tx = 1; tx < tilesX - 1; tx++) {
                if (!this.walkabilityMap[ty][tx]) {
                    // בדיקה אם מוקף בשבילים
                    let surroundingPaths = 0;
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            if (dx === 0 && dy === 0) continue;
                            if (this.walkabilityMap[ty + dy][tx + dx]) {
                                surroundingPaths++;
                            }
                        }
                    }
                    
                    // אם מוקף ב-6+ שבילים, זה כנראה חור
                    if (surroundingPaths >= 6) {
                        this.walkabilityMap[ty][tx] = true;
                    }
                }
            }
        }
    }
    
    /**
     * חיבור שבילים קרובים
     */
    connectNearbyPaths() {
        const connectDist = Math.ceil(this.config.connectDistance / this.config.tileSize);
        const tilesX = this.walkabilityMap[0].length;
        const tilesY = this.walkabilityMap.length;
        
        for (let ty = 0; ty < tilesY; ty++) {
            for (let tx = 0; tx < tilesX; tx++) {
                if (this.walkabilityMap[ty][tx]) {
                    // חיפוש שבילים קרובים
                    for (let dy = -connectDist; dy <= connectDist; dy++) {
                        for (let dx = -connectDist; dx <= connectDist; dx++) {
                            const ntx = tx + dx;
                            const nty = ty + dy;
                            
                            if (ntx >= 0 && ntx < tilesX && nty >= 0 && nty < tilesY) {
                                if (this.walkabilityMap[nty][ntx]) {
                                    // מילוי הקו ביניהם
                                    this.drawLine(tx, ty, ntx, nty);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    
    /**
     * ציור קו בין שתי נקודות (אלגוריתם Bresenham)
     */
    drawLine(x0, y0, x1, y1) {
        const dx = Math.abs(x1 - x0);
        const dy = Math.abs(y1 - y0);
        const sx = x0 < x1 ? 1 : -1;
        const sy = y0 < y1 ? 1 : -1;
        let err = dx - dy;
        
        while (true) {
            if (x0 >= 0 && x0 < this.walkabilityMap[0].length &&
                y0 >= 0 && y0 < this.walkabilityMap.length) {
                this.walkabilityMap[y0][x0] = true;
            }
            
            if (x0 === x1 && y0 === y1) break;
            
            const e2 = 2 * err;
            if (e2 > -dy) {
                err -= dy;
                x0 += sx;
            }
            if (e2 < dx) {
                err += dx;
                y0 += sy;
            }
        }
    }
    
    /**
     * בדיקה אם מיקום ניתן להליכה
     */
    isWalkable(x, y) {
        // בדיקה אם המפה מוכנה
        if (!this.walkabilityMap || this.walkabilityMap.length === 0) {
            console.warn('⚠️ מפת walkability לא מוכנה!');
            return false;
        }
        
        const tx = Math.floor(x / this.config.tileSize);
        const ty = Math.floor(y / this.config.tileSize);
        
        if (ty < 0 || ty >= this.walkabilityMap.length ||
            tx < 0 || tx >= this.walkabilityMap[0].length) {
            return false;
        }
        
        // בדיקה במפה
        if (this.walkabilityMap[ty][tx]) {
            return true;
        }
        
        // בדיקה בשבילים ידניים
        for (const path of this.config.manualPaths) {
            if (path.type === 'rect') {
                if (x >= path.x && x <= path.x + path.w &&
                    y >= path.y && y <= path.y + path.h) {
                    return true;
                }
            } else if (path.type === 'circle') {
                const dx = x - path.x;
                const dy = y - path.y;
                if (Math.sqrt(dx * dx + dy * dy) <= path.radius) {
                    return true;
                }
            }
        }
        
        return false;
    }
    
    /**
     * ציור מפת debug
     */
    drawDebugOverlay(ctx, cameraX, cameraY) {
        if (!this.debugMode || !this.walkabilityMap) return;
        
        ctx.globalAlpha = 0.5;
        const tileSize = this.config.tileSize;
        
        for (let ty = 0; ty < this.walkabilityMap.length; ty++) {
            for (let tx = 0; tx < this.walkabilityMap[0].length; tx++) {
                const screenX = tx * tileSize - cameraX;
                const screenY = ty * tileSize - cameraY;
                
                if (screenX > -tileSize && screenX < this.config.viewportWidth &&
                    screenY > -tileSize && screenY < this.config.viewportHeight) {
                    
                    ctx.fillStyle = this.walkabilityMap[ty][tx] ? 
                        'rgba(0, 255, 0, 0.3)' : 'rgba(255, 0, 0, 0.3)';
                    ctx.fillRect(screenX, screenY, tileSize, tileSize);
                }
            }
        }
        
        ctx.globalAlpha = 1.0;
    }
    
    /**
     * החלפת מצב debug
     */
    toggleDebugMode() {
        this.debugMode = !this.debugMode;
        console.log('🐛 מצב Debug:', this.debugMode ? 'פעיל' : 'כבוי');
        return this.debugMode;
    }
    
    /**
     * ייצוא תצורה
     */
    exportConfig() {
        return {
            imagePath: this.config.imagePath,
            imageWidth: this.image.width,
            imageHeight: this.image.height,
            pathColors: this.config.pathColors,
            fillGapsSize: this.config.fillGapsSize,
            connectDistance: this.config.connectDistance,
            manualPaths: this.config.manualPaths,
            tileSize: this.config.tileSize
        };
    }
    
    /**
     * הוספת שביל ידני
     */
    addManualPath(path) {
        this.config.manualPaths.push(path);
        console.log('➕ שביל ידני נוסף:', path);
    }
}
