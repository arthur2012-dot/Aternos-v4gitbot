import Groq from 'groq-sdk';
import { getKey } from '../utils/keys.js';

// THIS API IS NOT TO BE CONFUSED WITH GROK!
export class GroqCloudAPI {
    static prefix = 'groq';

    constructor(model_name, url, params) {
        this.model_name = model_name || 'llama-3.3-70b-versatile';
        this.url = url;
        this.params = params || {};

        if (this.params.tools)
            delete this.params.tools;

        if (this.url)
            console.warn('Groq Cloud has no implementation for custom URLs. Ignoring provided URL.');

        this.groq = new Groq({ apiKey: getKey('GROQCLOUD_API_KEY') });
    }

    async sendRequest(turns, systemMessage, stop_seq = null) {
        let messages = [{ role: 'system', content: systemMessage }].concat(turns);
        let res = null;

        try {
            console.log('Awaiting Groq response...');

            if (this.params.max_tokens) {
                this.params.max_completion_tokens = this.params.max_tokens;
                delete this.params.max_tokens;
            }
            if (!this.params.max_completion_tokens) {
                this.params.max_completion_tokens = 4000;
            }

            const completion = await this.groq.chat.completions.create({
                messages: messages,
                model: this.model_name,
                stream: false,
                stop: stop_seq,
                ...(this.params || {}),
            });

            res = completion.choices[0].message.content;
            res = res.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        } catch (err) {
            console.error('Groq error:', err.message || err);
            if (String(err).includes('rate_limit') || String(err).includes('429')) {
                res = 'Rate limited by Groq. Continuing in passive mode.';
            } else {
                res = 'My brain disconnected briefly. I will keep surviving.';
            }
        }

        return res;
    }

    async sendVisionRequest(messages, systemMessage, imageBuffer) {
        return 'Vision is disabled in this deploy.';
    }

    async embed(_) {
        return null;
    }
}
