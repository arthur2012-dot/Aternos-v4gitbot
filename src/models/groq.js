import Groq from 'groq-sdk';
import { getKey } from '../utils/keys.js';

export class GroqCloudAPI {
    constructor(model_name, url, params) {
        this.model_name = model_name;
        this.url = url;
        this.params = params || {};

        if (this.params.tools)
            delete this.params.tools;

        if (this.url)
            console.warn("Groq Cloud has no implementation for custom URLs. Ignoring provided URL.");

        this.groq = new Groq({ apiKey: getKey('GROQCLOUD_API_KEY') });
    }

    async sendRequest(turns, systemMessage, stop_seq = null) {
        let messages = [{"role": "system", "content": systemMessage}].concat(turns);
        let res = null;

        try {
            console.log("Awaiting Groq response...");

            const completion = await this.groq.chat.completions.create({
                messages: messages,
                model: this.model_name,
                ...(this.params || {}),
                ...(stop_seq ? { stop: stop_seq } : {})
            });

            res = completion.choices[0].message.content;
        } catch (err) {
            console.error("Groq error:", err.message || err);
            if (String(err).includes('rate_limit') || String(err).includes('429')) {
                res = "Rate limited by Groq. Continuing in passive mode.";
            } else {
                res = "My brain disconnected briefly. I'll keep surviving.";
            }
        }

        return res;
    }

    async embed(text) {
        return null;
    }
}
