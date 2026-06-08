/**
 * InteriorEngine - מנוע למסכים פנימיים של בניינים
 * מאפשר תנועה בתוך בניינים עם תמונת רקע ונקודות אינטראקציה
 * 
 * @author Cline AI Assistant
 * @version 1.0
 */

class InteriorEngine {
    constructor(config) {
        this.config = config;
        this.image = null;
        this.imageData = null;
        this.walkabilityMap = null;
        this.debugMode = false;
        this.isReady = false;
        
        // נקודות אינטראקציה
        this.interactionPoints = config.interactionPoints || [];
        this.exitPoint = config.exitPoint || null;
    }
    
    /**
     * טעינת התמונה
     */
    async loadImage() {
        return new Promise((resolve, reject) => {
            this.image = new Image();
            this.image.crossOrigin = "anonymous";
            
            this.image.onload = () => {
                console.log('✅ תמונת בניין נטענה:', this.config.name);
                this.analyzeImage();
                this.isReady = true;
                resolve();
            };
            
            this.image.onerror = (err) => {
                console.error('❌ שגיאה בטעינת תמונת בניין:', err);
                reject(err);
            };
            
            this.image.src = this.config.imagePath;
        });
    }
    
    /**
     * ניתוח התמונה - יצירת מפת walkability פשוטה
     * (בבניינים נניח שרוב השטח ניתן להליכה)
     */
    analyzeImage() {
        console.log('🔍 מנתח תמונת בניין...');
        
        const canvas = document.createElement('canvas');
        canvas.width = this.image.width;
        canvas.height = this.image.height;
        const ctx = canvas.getContext('2d');
        
        ctx.drawImage(this.image, 0, 0);
        this.imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        
        // יצירת מפת walkability פשוטה
        this.createSimpleWalkabilityMap();
        
        console.log('✅ ניתוח בניין הושלם');
    }
    
    /**
     * יצירת מפת walkability פשוטה
     * בבניינים, רוב השטח ניתן להליכה אלא אם כן מוגדר אחרת
     */
    createSimpleWalkabilityMap() {
        const tileSize = 8;
        const width = this.image.width;
        const height = this.image.height;
        
        const tilesX = Math.ceil(width / tileSize);
        const tilesY = Math.ceil(height / tileSize);
        
        this.walkabilityMap = [];
        
        for (let ty = 0; ty < tilesY; ty++) {
            this.walkabilityMap[ty] = [];
            for (let tx = 0; tx < tilesX; tx++) {
                // בברירת מחדל, הכל ניתן להליכה
                // אפשר להוסיף לוגיקה מתקדמת יותר לזיהוי קירות
                this.walkabilityMap[ty][tx] = true;
            }
        }
        
        this.tileSize = tileSize;
    }
    
    /**
     * בדיקה אם מיקום ניתן להליכה
     */
    isWalkable(x, y) {
        if (!this.walkabilityMap || this.walkabilityMap.length === 0) {
            return false;
        }
        
        const tx = Math.floor(x / this.tileSize);
        const ty = Math.floor(y / this.tileSize);
        
        if (ty < 0 || ty >= this.walkabilityMap.length ||
            tx < 0 || tx >= this.walkabilityMap[0].length) {
            return false;
        }
        
        return this.walkabilityMap[ty][tx];
    }
    
    /**
     * בדיקה אם השחקן קרוב לנקודת אינטראקציה
     */
    checkInteraction(playerX, playerY) {
        const interactionRadius = 50;
        
        // בדיקת נקודת יציאה
        if (this.exitPoint) {
            const dist = Math.sqrt(
                Math.pow(playerX - this.exitPoint.worldX, 2) + 
                Math.pow(playerY - this.exitPoint.worldY, 2)
            );
            if (dist < (this.exitPoint.radius || interactionRadius)) {
                return {
                    type: 'exit',
                    data: this.exitPoint
                };
            }
        }
        
        // בדיקת נקודות אינטראקציה
        for (const point of this.interactionPoints) {
            const dist = Math.sqrt(
                Math.pow(playerX - point.worldX, 2) + 
                Math.pow(playerY - point.worldY, 2)
            );
            if (dist < interactionRadius) {
                return {
                    type: 'interaction',
                    data: point
                };
            }
        }
        
        return null;
    }
    
    /**
     * קבלת כל נקודות האינטראקציה הנראות במסך
     */
    getVisibleInteractions(cameraX, cameraY, viewportWidth, viewportHeight) {
        const visible = [];
        
        // נקודת יציאה
        if (this.exitPoint) {
            const screenX = this.exitPoint.worldX - cameraX;
            const screenY = this.exitPoint.worldY - cameraY;
            if (screenX > -50 && screenX < viewportWidth + 50 &&
                screenY > -50 && screenY < viewportHeight + 50) {
                visible.push({
                    ...this.exitPoint,
                    screenX,
                    screenY,
                    type: 'exit'
                });
            }
        }
        
        // נקודות אינטראקציה
        for (const point of this.interactionPoints) {
            const screenX = point.worldX - cameraX;
            const screenY = point.worldY - cameraY;
            if (screenX > -50 && screenX < viewportWidth + 50 &&
                screenY > -50 && screenY < viewportHeight + 50) {
                visible.push({
                    ...point,
                    screenX,
                    screenY,
                    type: 'interaction'
                });
            }
        }
        
        return visible;
    }
    
    /**
     * ציור מפת debug
     */
    drawDebugOverlay(ctx, cameraX, cameraY, viewportWidth, viewportHeight) {
        if (!this.debugMode) return;
        
        ctx.globalAlpha = 0.3;
        
        // ציור נקודות אינטראקציה
        for (const point of this.interactionPoints) {
            const screenX = point.worldX - cameraX;
            const screenY = point.worldY - cameraY;
            
            ctx.fillStyle = 'rgba(0, 255, 0, 0.5)';
            ctx.beginPath();
            ctx.arc(screenX, screenY, 50, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.fillStyle = 'white';
            ctx.font = '12px Arial';
            ctx.fillText(point.label, screenX - 20, screenY - 60);
        }
        
        // ציור נקודת יציאה
        if (this.exitPoint) {
            const screenX = this.exitPoint.worldX - cameraX;
            const screenY = this.exitPoint.worldY - cameraY;
            
            ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
            ctx.beginPath();
            ctx.arc(screenX, screenY, this.exitPoint.radius || 50, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.fillStyle = 'white';
            ctx.font = '12px Arial';
            ctx.fillText('EXIT', screenX - 15, screenY - 60);
        }
        
        ctx.globalAlpha = 1.0;
    }
    
    /**
     * החלפת מצב debug
     */
    toggleDebugMode() {
        this.debugMode = !this.debugMode;
        console.log('🐛 מצב Debug (בניין):', this.debugMode ? 'פעיל' : 'כבוי');
        return this.debugMode;
    }
}
