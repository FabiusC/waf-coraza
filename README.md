# waf-coraza

Monorepo con dos aplicaciones:

- `waf/`: backend en Go + Coraza WAF.
- `dashboard/`: frontend en React + TypeScript (Vite).

## URLs públicas del aplicativo

- WAF (backend): https://waf-coraza.onrender.com
- Dashboard (frontend): https://waf-coraza.netlify.app

## Guía de usuario (uso del aplicativo)

### 1. Uso desde navegador

1. Abre el dashboard: https://waf-coraza.netlify.app
2. Revisa métricas en tiempo real:
   - Total de solicitudes
   - Permitidas
   - Bloqueadas
3. Ejecuta pruebas desde el módulo de laboratorio WAF.
4. Verifica resultados en:
   - Historial de validación
   - Consola de tráfico
   - Tabla de actividad reciente

### 2. Uso desde consola (cualquier equipo)

Puedes enviar solicitudes directas al backend público y se visualizarán en el dashboard.

Pruebas permitidas (esperado 200):

```bash
curl -i "https://waf-coraza.onrender.com/app"
```

Pruebas maliciosas (esperado 403):

```bash
curl -i "https://waf-coraza.onrender.com/admin"
curl -i "https://waf-coraza.onrender.com/app?q=union%20select%201"
curl -i "https://waf-coraza.onrender.com/app?q=%3Cscript%3Ealert(1)%3C/script%3E"
curl -i "https://waf-coraza.onrender.com/app?file=../../etc/passwd"
```

### 3. Criterio de verificación

1. Las solicitudes maliciosas deben responder HTTP 403.
2. Las solicitudes legítimas deben responder HTTP 200.
3. En el dashboard deben aumentar los contadores y verse los eventos recientes.

## Arquitectura

- El backend expone `/api/stats`, `/api/recent`, `/healthz` y `/app`.
- El dashboard consulta la API usando `VITE_WAF_API_URL`.

## Guía de instalación y ejecución (monorepo)

## Requisitos

- Go 1.23+
- Node.js 20+
- npm 10+

## 1. Clonar el repositorio

```bash
git clone <URL_DEL_REPOSITORIO>
cd waf-coraza
```

## 2. Ejecutar backend (waf)

```bash
cd waf
go mod tidy
go run .
```

Backend local disponible en:

- http://localhost:8080

## 3. Ejecutar frontend (dashboard)

En otra terminal:

```bash
cd dashboard
npm install
```

Crea `dashboard/.env` para apuntar al backend local:

```bash
VITE_WAF_API_URL=http://localhost:8080
```

Inicia el frontend:

```bash
npm run dev
```

Frontend local (normalmente):

- http://localhost:5173

## 4. Ejecución en producción

- Backend productivo: https://waf-coraza.onrender.com
- Frontend productivo: https://waf-coraza.netlify.app

Para que el dashboard productivo funcione correctamente, la variable en Netlify debe ser:

```bash
VITE_WAF_API_URL=https://waf-coraza.onrender.com
```

## Notas operativas

- El backend mantiene estadísticas y eventos recientes en memoria.
- El dashboard refresca automáticamente la información cada pocos segundos.
- Si cambias de proveedor de backend, actualiza `VITE_WAF_API_URL`.
