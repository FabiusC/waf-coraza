# waf-coraza

Monorrepo con dos aplicaciones separadas:

- `waf/`: servidor Go con Coraza WAF, pensado para desplegar en Fly.io.
- `dashboard/`: interfaz React + TypeScript para mostrar el tráfico y los eventos, pensada para Netlify.

## Arquitectura

- El backend expone el tráfico y las alertas por `/api/stats`, `/api/recent`, `/healthz` y `/app`.
- El dashboard consume la API del backend usando `VITE_WAF_API_URL`.
- El dashboard se despliega por separado en Netlify.

## Backend

```bash
cd waf
go mod tidy
go run .
```

Despliegue en Fly.io:

```bash
cd waf
fly auth login
fly launch
fly deploy
```

## Dashboard

```bash
cd dashboard
npm install
npm run dev
```

Para Netlify, define `VITE_WAF_API_URL` apuntando a la URL pública del backend en Fly.io.

## Flujo recomendado

1. Desplegar primero `waf/` en Fly.io.
2. Copiar la URL pública del backend.
3. Configurar `VITE_WAF_API_URL` en Netlify.
4. Desplegar `dashboard/`.
