# Titan Cloud Music System

Sistema cloud para un bot musical avanzado de Discord. Incluye:

- bot de Discord con slash commands
- motor musical y cola avanzada
- snapshots de sesiones
- API HTTP para dashboard y operaciones
- panel web basico en tiempo real mediante polling y SSE
- integracion centrada en Neon

## Arquitectura resumida

- `src/index.js`: arranque principal del sistema
- `src/services/music-system.js`: capa musical y control de sesiones
- `src/api/server.js`: API del dashboard
- `src/repositories/*`: persistencia en memoria o Postgres
- `database/schema.sql`: esquema operativo para Neon/Postgres

## Requisitos

- Node.js 22.12 o superior
- FFmpeg instalado y disponible en `PATH`
- proyecto de Discord configurado
- `DATABASE_URL` de Neon para persistencia real

## Instalacion

```bash
npm install
```

1. Copia `.env.example` a `.env`
2. Rellena al menos:
   - `DISCORD_TOKEN`
   - `DISCORD_CLIENT_ID`
   - `DATABASE_URL` si vas a usar Neon o Postgres real
3. Ejecuta migraciones sobre Neon:

```bash
npm run migrate
```

4. Registra los slash commands:

```bash
npm run register
```

5. Inicia el sistema:

```bash
npm start
```

## Dashboard

Al arrancar, el sistema levanta un dashboard en:

- `http://localhost:3000`

Endpoints principales:

- `GET /health`
- `GET /api/system/health`
- `GET /api/sessions`
- `GET /api/guilds/:guildId/settings`
- `PUT /api/guilds/:guildId/settings`
- `GET /api/events`

Si defines `DASHBOARD_ADMIN_TOKEN`, debes enviarlo como header `x-admin-token` para cambios de escritura.

## Comandos del bot

- `/play`
- `/queue`
- `/nowplaying`
- `/pause`
- `/resume`
- `/skip`
- `/stop`
- `/volume`
- `/loop`
- `/shuffle`
- `/autoplay`
- `/filter`
- `/seek`
- `/disconnect`
- `/restore`
- `/settings`
- `/status`

## Neon-only

La idea correcta para produccion es:

- bot y API en compute persistente
- Neon como DB operativa principal
- alertas, metricas y logs centralizados

## Siempre vivo

Neon es la base de datos, no el host del bot. Para que el bot no duerma:

- el bot debe vivir en compute persistente
- el endpoint de Neon debe quedar con `suspend_timeout_seconds=0`
- el backend debe tolerar fallos temporales de DB y seguir vivo con cache/memoria

## Render

El repositorio ya incluye `render.yaml` y `Dockerfile` para desplegarlo como servicio web en Render.

Recomendacion para que no duerma:

- usar plan `Starter` o superior
- mantener `healthCheckPath` en `/health`
- cargar `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` y `DATABASE_URL` como variables seguras

## Nota sobre musica

El sistema intenta encontrar la musica en YouTube y reproducirla si la fuente es accesible. Algunas pistas pueden fallar por restricciones externas del proveedor.
