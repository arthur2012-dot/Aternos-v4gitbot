import { Agent } from '../agent/agent.js';
import { settings as defaultSettings } from '../agent/settings.js';
import yargs from 'yargs';

const args = process.argv.slice(2);
if (args.length < 1) {
    console.log('Usage: node init_agent.js <agent_name> [profile_path]');
    process.exit(1);
}

const agent_name = args[0];
const profile_path = args[1];

async function main() {
    const agent = new Agent();
    await agent.start(defaultSettings, profile_path);
}

main().catch(console.error);
