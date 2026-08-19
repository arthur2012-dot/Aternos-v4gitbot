/**
 * Stub coder — coding disabled (allow_insecure_coding: false).
 * Avoids hard dependency on eslint at runtime.
 */
export class Coder {
  constructor(agent) {
    this.agent = agent;
    this.file_counter = 0;
    this.fp = './bots/coder/';
  }

  async generateCode() {
    return 'Coding disabled.';
  }

  async execute() {
    return 'Coding disabled.';
  }

  async writeFile() {
    return false;
  }

  checkCode() {
    return { valid: false, message: 'Coding disabled' };
  }

  async stageCode() {
    return null;
  }

  cancel() {}
  clear() {}
}
