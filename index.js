const { EventEmitter } = require('events');
const WebSocket = require('ws');
const Client = require('./client');

class Interactly extends EventEmitter {
    constructor(apiToken, apiBaseUrl) {
        super();
        this.client = new Client(apiToken, apiBaseUrl);
    }

    async start(callSid) {
        this.stop();
        this.callSid = callSid;
        const events = await this.client.fetchCallHistory(callSid);
        if (events && events.length) {
            events.forEach((event) => {
                this.handleNewEventReceived(JSON.stringify(event));
            });
        }
        this.webSocketConnection(callSid);
    }

    stop() {
        this.socket?.close();
        this.socket = null;
        this.callSid = null;
    }
    async webSocketConnection(callSid) {
        const sessionId = await this.client.fetchSession();
        if (!sessionId) {
            this.emit('error', 'invalid token');
            return;
        }
        this.socket = new WebSocket(`${this.client.WS_URL}?token=${sessionId}`);

        this.socket.addEventListener('open', (event) => {
            this.sendMessage({ event: 'register', callSid });
        });

        this.socket.addEventListener('message', (event) => {
            this.handleNewEventReceived(event.data);
        });

        this.socket.addEventListener('error', (event) => {
            this.emit('error', event);
        });

        this.socket.addEventListener('close', (event) => {
            this.emit('close');
        });
    }
    sendMessage(message) {
        if (this.socket) {
            this.socket.send(JSON.stringify(message));
        }
    }
    handleNewEventReceived(data) {
        const parsedData = JSON.parse(data);
        const { event, type, payload = {} } = parsedData || {};
        if (!event) {
            return;
        }
        const {
            timestamp = new Date(),
            status = '',
            userNumber = '',
            source = '',
            text = '',
            recording: {
                s3Link = '',
            } = {},
        } = payload;
        if (type === 'status') {
            if (status === 'trying') {
                return;
            }
            if (status === 'in-progress') {
                this.emit('call-start', userNumber);
            } else if (status === 'completed', userNumber) {
                this.emit('call-end');
            }
        } else if (type === 'message') {
            const speaker = source === 'agent' ? 'Assistant' : 'User';
            this.emit('message', { speaker, text, timestamp });
        } else if (type === 'assistant-config') {
            this.emit('assistant-config', payload);
        } else if (type === 'recording') {
            this.emit('recording', s3Link);
        } else if (type === 'summary') {
            this.emit('summary', payload);
        }
    }
}

module.exports = { Interactly };