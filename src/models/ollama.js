import { strictFormat } from '../utils/text.js';

export class Ollama {
    static prefix = 'ollama';
    constructor(model_name, url, params) {
        this.model_name = model_name;
        this.params = params;
        this.url = url || 'http://127.0.0.1:11434';
        this.chat_endpoint = '/api/chat';
        this.embedding_endpoint = '/api/embeddings';
        this._requestInProgress = false;
    }

    async sendRequest(turns, systemMessage) {
        while (this._requestInProgress) {
            await new Promise(r => setTimeout(r, 100));
        }
        this._requestInProgress = true;
        try {
        let model = this.model_name || 'sweaterdog/andy-4:micro-q8_0';
        let messages = strictFormat(turns);
        messages.unshift({ role: 'system', content: systemMessage });
        const maxAttempts = 5;
        let attempt = 0;
        let finalRes = null;

        while (attempt < maxAttempts) {
            attempt++;
            console.log(`Awaiting local response... (model: ${model}, attempt: ${attempt})`);
            let res = null;
            try {
                let apiResponse = await this.send(this.chat_endpoint, {
                    model: model,
                    messages: messages,
                    stream: false,
                    think: this.params?.think,
                    options: {
                        temperature: this.params?.temperature,
                        top_k: this.params?.top_k,
                        top_p: this.params?.top_p,
                        repeat_penalty: this.params?.repeat_penalty,
                        num_ctx: this.params?.num_ctx,
                        num_predict: this.params?.num_predict,
                    }
                });
                if (apiResponse) {
                    res = apiResponse['message']['content'] || '';
                    if (!res && apiResponse['message']['thinking']) {
                        res = apiResponse['message']['thinking'];
                    }
                } else {
                    res = 'No response data.';
                }
            } catch (err) {
                if (err.message.toLowerCase().includes('context length') && messages.length > 2) {
                    console.log('Context length exceeded, trying again with shorter context.');
                    messages.splice(1, 2);
                    continue;
                } else {
                    console.log(err);
                    res = 'My brain disconnected, try again.';
                }
            }

            const hasOpenTag = res.includes("<think>");
            const hasCloseTag = res.includes("</think>");

            if ((hasOpenTag && !hasCloseTag)) {
                console.warn("Partial <think> block detected. Re-generating...");
                if (attempt < maxAttempts) continue;
            }
            if (hasCloseTag && !hasOpenTag) {
                res = '<think>' + res;
            }
            if (hasOpenTag && hasCloseTag) {
                res = res.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
            }
            finalRes = res;
            break;
        }

        if (finalRes == null) {
            console.warn("Could not get a valid response after max attempts.");
            finalRes = 'I thought too hard, sorry, try again.';
        }
        return finalRes;
        } finally {
            this._requestInProgress = false;
        }
    }

    async embed(text) {
        let model = this.model_name || 'embeddinggemma';
        let body = { model: model, prompt: text };
        let res = await this.send(this.embedding_endpoint, body);
        if (res && res['embedding']) {
            return res['embedding'];
        }
        if (res && res['embeddings'] && res['embeddings'].length > 0) {
            return res['embeddings'][0];
        }
        return null;
    }

    async send(endpoint, body) {
        const url = new URL(endpoint, this.url);
        let method = 'POST';
        let headers = new Headers();
        const request = new Request(url, { method, headers, body: JSON.stringify(body) });
        let data = null;
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 60000);
            const res = await fetch(request, { signal: controller.signal });
            clearTimeout(timeout);
            if (res.ok) {
                data = await res.json();
            } else {
                const errorBody = await res.text().catch(() => '');
                const err = new Error(`Ollama Status: ${res.status}: ${errorBody.substring(0, 200)}`);
                err.statusCode = res.status;
                throw err;
            }
        } catch (err) {
            if (err.name === 'AbortError') {
                console.error('Ollama request timed out after 60s');
                throw new Error('Ollama request timed out');
            }
            console.error('Failed to send Ollama request.');
            console.error(err);
            throw err;
        }
        return data;
    }

    async sendVisionRequest(messages, systemMessage, imageBuffer) {
        const imageMessages = [...messages];
        imageMessages.push({
            role: "user",
            content: [
                { type: "text", text: systemMessage },
                {
                    type: "image_url",
                    image_url: {
                        url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}`
                    }
                }
            ]
        });
        
        return this.sendRequest(imageMessages, systemMessage);
    }
}
