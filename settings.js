const settings = {
    // false = auto-detect version from the server (needs latest mineflayer/protocol)
    "minecraft_version": false,
    "host": "DarkFantasytxt.aternos.me",
    // Aternos port
    "port": 25831,
    "auth": "offline",
    "mindserver_port": Number(process.env.PORT) || 8080,
    "auto_open_ui": false,
    "base_profile": "survival",
    "profiles": ["./profiles/dream.json"],
    "load_memory": true,
    "init_message": "",
    "only_chat_with": [],
    "speak": false,
    "chat_ingame": true,
    "language": "en",
    "render_bot_view": false,
    "show_bot_views": false,
    "allow_insecure_coding": false,
    "allow_vision": false,
    "blocked_actions": ["!checkBlueprint", "!checkBlueprintLevel", "!getBlueprint", "!getBlueprintLevel"],
    "code_timeout_mins": -1,
    "relevant_docs_count": 5,
    "max_messages": 15,
    "num_examples": 0,
    "max_commands": -1,
    "show_command_syntax": "full",
    "narrate_behavior": false,
    "chat_bot_messages": false,
    "spawn_timeout": 120,
    "block_place_delay": 80,
    "log_all_prompts": false,
};
export default settings;

// Expose host/port for the offline-queue waiter (agent_process)
if (typeof process !== 'undefined') {
    process.env.MC_HOST = process.env.MC_HOST || settings.host;
    process.env.MC_PORT = process.env.MC_PORT || String(settings.port);
}
