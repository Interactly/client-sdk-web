const axios = require('axios');

class Client {
    constructor(apiToken, apiBaseUrl) {
        this.apiToken = apiToken;
        this.apiBaseUrl = apiBaseUrl;
        axios.defaults.headers.common['Authorization'] = `Bearer ${apiToken}`;

        this.server = apiBaseUrl || '';
        if (!this.server) {
            throw new Error('apiBaseUrl is required');
        }
        this.FETCH_SESSION_URL = `${this.server}/events/v1/calls/session`;
        this.WS_URL = `${this.server.replce('http', 'ws')}/events-proxy`;

    }

    async fetchCallHistory(callSid) {
        if (!callSid) {
            throw new Error('callSid is required');
        }
        try {
            const url = `${this.server}/events/v1/calls/${callSid}/history`;
            const { data: { events = [] } = {} } = await axios.get(url);
            return events;
        } catch {
            return []
        }
    }
    async fetchSession() {
        try {
            const { data: { session: { id: sessionId } = {} } = {} } = await axios.get(this.FETCH_SESSION_URL);
            return sessionId;
        } catch {
            return null;
        }
    }
}
module.exports = Client;
