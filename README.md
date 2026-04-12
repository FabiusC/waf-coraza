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

Para local, puedes usar un archivo `.env` dentro de `dashboard/`:

```bash
VITE_WAF_API_URL=http://localhost:8080
```

### Deploy del dashboard en Netlify desde GitHub

1. En Netlify, usa **Add new site** -> **Import an existing project**.
2. Conecta GitHub y selecciona este repositorio.
3. No cambies Build settings manualmente: Netlify leerá `netlify.toml` desde la raíz del repo.
4. En **Site configuration** -> **Environment variables**, crea:
   - `VITE_WAF_API_URL` = URL pública del backend (Fly.io o túnel Cloudflare).
5. Ejecuta el primer deploy.

Con esto, cada push a `main` dispara un nuevo deploy automático en Netlify.

## Flujo recomendado

1. Desplegar primero `waf/` en Fly.io.
2. Copiar la URL pública del backend.
3. Configurar `VITE_WAF_API_URL` en Netlify.
4. Desplegar `dashboard/`.
