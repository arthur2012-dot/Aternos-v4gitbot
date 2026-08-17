# DreamBot (Mindcraft)

Bot Minecraft estilo Dream para Aternos via Railway.

## Como funciona

No `npm install` / start, o script `scripts/fetch-base.js`:
1. Clona o mindcraft oficial
2. Aplica patches DreamBot (morte, PvP só defensivo, return_home, gestos, pathfinder humano)
3. Usa `settings.js` + `profiles/dream.json` + key Groq

## Railway

- **Build:** `npm install` (precisa de `git` na imagem)
- **Start:** `npm start`
- Servidor: `DarkFantasytxt.aternos.me:31082`
- mindserver: porta **8081**
- Nome no jogo: **DreamBot**

Opcional env: `GROQCLOUD_API_KEY`

## Isolamento

Use um **serviço Railway separado** do outro bot. Porta 8081 evita conflito.
