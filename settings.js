const settings = {
    "minecraft_version": "1.21.11",
    "host": "DarkFantasytxt.aternos.me",
    "port": 25831,
    "auth": "offline",
    "mindserver_port": Number(process.env.PORT) || 8080,
    "auto_open_ui": false,
    "base_profile": "survival",
    "profiles": ["./profiles/dream.json"],
    "load_memory": true,
    // Starts continuous survival loop so bot does not freeze after 1 action
    "init_message": "!selfPrompt(\"Sobreviver: madeira, tools, comida, casa longe do spawn, ferro, portal. Se preso, destravar. Sempre escolha a proxima acao.