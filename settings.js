const settings = {
    // MUST match Aternos exactly — never use false/auto (causes protocol -1)
    "minecraft_version": "1.21.11",
    "host": "DarkFantasytxt.aternos.me",
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

if (typeof process !== 'undefined') {
    process.env.MC_HOST = process.env.MC_HOST || settings.host;
    process.env.MC_PORT = process.env.MC_PORT || String(settings.port);
    process.env.MC_VERSION = process.env.MC_VERSION || settings.minecraft_version;
}
