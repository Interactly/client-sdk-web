class Client {
    constructor(apiToken, server) {
        this.apiToken = apiToken;

        this.server = server || '';
        if (!this.server) {
            throw new Error('server url is required');
        }

        this.FETCH_SESSION_URL = `${this.server}/events/v1/calls/session`;
        this.WS_URL = `${this.server.replace('http', 'ws')}/calls-proxy`;

    }

    async fetchSession() {
        try {
            const response = await fetch(this.FETCH_SESSION_URL, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.apiToken}`,
                    'Content-Type': 'application/json'
                }
            });
            const data = await response.json();
            const sessionId = data?.session?.id ?? null;
            return sessionId;
        } catch {
            return null;
        }
    }
}

class Interactly {
    constructor(options = {}) {

        this.client = new Client(options.apiToken, options.server);
        // Initialize properties
        this.ws = null;
        this.mediaStream = null;
        this.audioContext = null;
        this.isRecording = false;
        this.currentSource = null;
        this.downsampleWorker = null;

        // Configuration options with defaults
        this.assistantId = options.assistantId || '';
        this.server = options.server || '';

        // Reconnection configuration
        this.reconnectConfig = {
            enabled: options.reconnect?.enabled ?? true,
            maxAttempts: options.reconnect?.maxAttempts ?? 10,
            initialDelay: options.reconnect?.initialDelay ?? 1000,
            maxDelay: options.reconnect?.maxDelay ?? 30000,
            factor: options.reconnect?.factor ?? 2
        };

        // Reconnection state
        this.reconnectAttempts = 1;
        this.reconnectTimer = null;
        this.isReconnecting = false;
        this.shouldAttemptReconnect = false;

        // Event handlers storage
        this.eventHandlers = {
            open: [],
            close: [],
            error: [],
            message: [],
            disconnect: [],
            streamStart: [],
            streamEnd: [],
            audioPlay: [],
            audioEnd: [],
            reconnecting: [],
            reconnected: [],
            reconnectError: [],
            reconnectFailed: [],
            'call-start': [],
            'call-end': [],
            'assistant-config': [],
            'unknown': []
        };


        // Set up URLs
        this.FETCH_CONVERSATION_SESSION_URL = `${this.server}/events/v1/calls/session`;
        this.WS_URL = `${this.server.replace('http', 'ws')}/calls-proxy`;

        // Initialize worker
        this.initWorker();
    }


    // Worker initialization
    initWorker() {
        const workerCode = `
        let sampleRate = 44100;
        let targetRate = 8000;
        
        self.onmessage = function(e) {
          if (e.data.type === 'init') {
            sampleRate = e.data.sampleRate;
            return;
          }
          
          const audioData = e.data.audioData;
          const downsampledData = downsample(audioData);
          self.postMessage(downsampledData);
        };
        
        function downsample(audioData) {
          const ratio = sampleRate / targetRate;
          const newLength = Math.round(audioData.length / ratio);
          const result = new Int16Array(newLength);
          
          for (let i = 0; i < newLength; i++) {
            const pos = Math.floor(i * ratio);
            const sample = audioData[pos] * 32767;
            result[i] = Math.max(-32768, Math.min(32767, Math.round(sample)));
          }
          
          return result;
        }
      `;

        const workerBlob = new Blob([workerCode], {
            type: 'application/javascript'
        });
        const workerUrl = URL.createObjectURL(workerBlob);
        this.downsampleWorker = new Worker(workerUrl);
    }

    // Event handling methods
    on(eventName, callback) {
        if (this.eventHandlers[eventName]) {
            this.eventHandlers[eventName].push(callback);
        } else {
            console.warn(`Unknown event: ${eventName}`);
        }
        return this;
    }

    off(eventName, callback) {
        if (this.eventHandlers[eventName]) {
            this.eventHandlers[eventName] = this.eventHandlers[eventName].filter(
                (handler) => handler !== callback
            );
        }
        return this;
    }

    emit(eventName, data) {
        if (this.eventHandlers[eventName]) {
            this.eventHandlers[eventName].forEach((handler) => handler(data));
        }
    }

    // Audio utility methods
    base64ToBinary(base64) {
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
    }

    uint8ToInt16(uint8Array) {
        return new Int16Array(uint8Array.buffer);
    }

    int16ToFloat32(int16Array) {
        const float32Array = new Float32Array(int16Array.length);
        for (let i = 0; i < int16Array.length; i++) {
            float32Array[i] = int16Array[i] / 32768.0;
        }
        return float32Array;
    }

    async initAudioContext() {
        if (!this.audioContext) {
            this.audioContext = new AudioContext();
        }
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
    }

    stopPlayback() {
        if (this.currentSource) {
            this.currentSource.stop();
            this.currentSource = null;
        }
        this.emit('audioEnd', { timestamp: Date.now() });
    }

    async convertAndPlay(base64, contentType, sampleRate) {
        try {
            await this.initAudioContext();
            this.stopPlayback();

            if (!base64) {
                throw new Error('No audio data provided');
            }

            let binary = this.base64ToBinary(base64);
            if (contentType === 'wav') {
                binary = binary.slice(44);
            }

            const int16Data = this.uint8ToInt16(binary);
            const float32Data = this.int16ToFloat32(int16Data);
            const startTime = Date.now();

            const audioBuffer = this.audioContext.createBuffer(
                1,
                float32Data.length,
                Number(sampleRate)
            );
            audioBuffer.getChannelData(0).set(float32Data);

            this.currentSource = this.audioContext.createBufferSource();
            this.currentSource.buffer = audioBuffer;
            this.currentSource.connect(this.audioContext.destination);
            this.currentSource.start();

            this.emit('audioPlay', { timestamp: startTime });

            this.currentSource.onended = () => {
                const playbackMilliseconds = Date.now() - startTime;
                this.emit('audioEnd', { playbackMilliseconds });
                this.currentSource = null;
                if (this.ws) {
                    this.ws.send(
                        JSON.stringify({ type: 'playDone', data: { playbackMilliseconds } })
                    );
                }
            };
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    // WebSocket methods

    handleCallUpdates(parsedData) {
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
        switch (type) {
            case 'status':
                switch (status) {
                    case 'trying':
                        return;
                    case 'in-progress':
                        this.emit('call-start', userNumber);
                        break;
                    case 'completed':
                        this.emit('call-end');
                        break;
                    default:
                        break;
                }
                break;

            case 'message': {
                const speaker = source === 'agent' ? 'Assistant' : 'User';
                this.emit('message', { speaker, text, timestamp });
                break;
            }

            case 'assistant-config':
                this.emit('assistant-config', payload);
                break;

            case 'recording':
                this.emit('recording', s3Link);
                break;

            case 'summary':
                this.emit('summary', payload);
                break;

            default:
                break;
        }

    }
    handleMessage(msg) {
        try {
            const data = JSON.parse(msg);
            if (data.event === 'call-updates') {
                this.handleCallUpdates(data);
                return;
            }
            switch (data.type) {
                case 'playAudio':
                    this.convertAndPlay(
                        data.data.audioContent,
                        data.data.audioContentType,
                        data.data.sampleRate
                    );
                    break;
                case 'killAudio':
                    this.stopPlayback();
                    break;
                case 'disconnect':
                    this.ws.close();
                    break;
                default:
                    this.emit('unknown', data);
                    break;
            }
        } catch (error) {
            this.emit('error', error);
        }
    }

    async reconnect() {
        if (!this.reconnectConfig.enabled || !this.shouldAttemptReconnect) {
            return;
        }

        if (this.reconnectAttempts >= this.reconnectConfig.maxAttempts) {
            this.emit('reconnectFailed', {
                attempts: this.reconnectAttempts,
                message: 'Max reconnection attempts reached'
            });
            this.shouldAttemptReconnect = false;
            return;
        }

        this.isReconnecting = true;
        this.reconnectAttempts++;

        const delay = Math.min(
            this.reconnectConfig.initialDelay *
            Math.pow(this.reconnectConfig.factor, this.reconnectAttempts - 1),
            this.reconnectConfig.maxDelay
        );

        this.emit('reconnecting', {
            attempt: this.reconnectAttempts,
            delay,
            maxAttempts: this.reconnectConfig.maxAttempts
        });

        await new Promise((resolve) => {
            this.reconnectTimer = setTimeout(resolve, delay);
        });

        try {
            await this.connect();
            this.isReconnecting = false;
            this.reconnectAttempts = 0;
            this.emit('reconnected', { timestamp: Date.now() });

            if (this.isRecording) {
                await this.startStreaming();
            }
        } catch (error) {
            this.emit('reconnectError', { error, attempt: this.reconnectAttempts });
            this.reconnect();
        }
    }

    clearReconnection() {
        this.shouldAttemptReconnect = false;
        this.isReconnecting = false;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    async connect(assistantId = this.assistantId) {
        try {
            const sessionId = await this.client.fetchSession();
            const url = `${this.WS_URL}?token=${sessionId}`;

            if (this.ws) {
                this.ws.close();
            }

            this.ws = new WebSocket(url);
            this.shouldAttemptReconnect = true;

            this.ws.onopen = (event) => {
                this.emit('open', event);
                this.reconnectAttempts = 0;

                setTimeout(() => {
                    this.ws.send(
                        JSON.stringify({
                            type: 'startCall',
                            assistantId,
                        })
                    );
                }, 100);
            };

            this.ws.onclose = (event) => {
                this.emit('close', event);
                if (this.shouldAttemptReconnect && this.reconnectConfig.enabled) {
                    // this.reconnect();
                }
            };

            this.ws.onerror = (error) => {
                this.emit('error', error);
            };

            this.ws.onmessage = async (event) => {
                if (event.type === 'message' && typeof event.data === 'string') {
                    this.handleMessage(event.data);
                    return;
                }
            };
        } catch (error) {
            this.emit('error', error);
            if (this.shouldAttemptReconnect) {
                // this.reconnect();
            }
            throw error;
        }
    }

    // Streaming methods
    async start(assistantId = this.assistantId) {
        try {
            await this.connect(assistantId);
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: true
            });
            await this.initAudioContext();

            const source = this.audioContext.createMediaStreamSource(
                this.mediaStream
            );
            const processor = this.audioContext.createScriptProcessor(1024, 1, 1);

            this.downsampleWorker.postMessage({
                type: 'init',
                sampleRate: this.audioContext.sampleRate
            });

            processor.onaudioprocess = (e) => {
                if (!this.isRecording) return;
                const inputData = e.inputBuffer.getChannelData(0);
                this.downsampleWorker.postMessage({
                    type: 'process',
                    audioData: inputData
                });
            };

            this.downsampleWorker.onmessage = (e) => {
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(e.data);
                }
            };

            source.connect(processor);
            processor.connect(this.audioContext.destination);

            this.isRecording = true;
            this.emit('streamStart', { timestamp: Date.now() });
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    stop() {
        this.clearReconnection();
        this.isRecording = false;

        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach((track) => track.stop());
        }

        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        if (this.ws) {
            this.ws.close();
        }

        this.emit('streamEnd', { timestamp: Date.now() });
    }

    async manualReconnect() {
        this.shouldAttemptReconnect = true;
        this.reconnectAttempts = 0;
        await this.reconnect();
    }
}

module.exports = { Interactly };