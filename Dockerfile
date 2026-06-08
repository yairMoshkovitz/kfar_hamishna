# Dockerfile לפריסת האתר הסטטי (כפר המשנה) ב-Railway
# מגיש את הקבצים דרך nginx ומאזין על ה-PORT ש-Railway מזריק בזמן ריצה.
FROM nginx:1.27-alpine

# פורט ברירת מחדל להרצה מקומית. ב-Railway המשתנה PORT נדרס אוטומטית.
ENV PORT=8080

# תבנית התצורה - מומרת ל-conf אמיתי בזמן עליית הקונטיינר (החלפת ${PORT}).
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# קבצי האתר
COPY main.html /usr/share/nginx/html/
COPY map-config.js /usr/share/nginx/html/
COPY map-engine.js /usr/share/nginx/html/
COPY interior-config.js /usr/share/nginx/html/
COPY interior-engine.js /usr/share/nginx/html/
COPY מפה-חדשה-אבנים.jpg /usr/share/nginx/html/
COPY בית-מדרש.jpg /usr/share/nginx/html/
COPY בית-פרטי1.jpg /usr/share/nginx/html/

# nginx:alpine מריץ אוטומטית envsubst על /etc/nginx/templates/*.template
# ומחליף רק את המשתנים שברשימה (כדי לא לפגוע במשתני nginx כמו $uri).
ENV NGINX_ENVSUBST_FILTER="PORT"

EXPOSE 8080

# entrypoint של התמונה הרשמית מטפל ב-envsubst ואז מריץ את הפקודה הזו.
CMD ["nginx", "-g", "daemon off;"]
