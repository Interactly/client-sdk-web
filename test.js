const { Interactly } = require(".");


const interactly = new Interactly('your-public-key');
interactly.start('your-callSid');

interactly.on('call-start', (userNumber) => {
    console.log(`Call started by ${userNumber}`);
});

interactly.on('call-end', () => {
    console.log('Call ended');
    interactly.stop();
});

interactly.on('message', (message) => {
    console.log('message:', message);
});

interactly.on('recording', (recordingLink) => {
    console.log('recording link:', recordingLink);
});

interactly.on('assistant-config', (config) => {
    console.log('assistant-config:', config);
});

interactly.on('error', (error) => {
    console.error('Error:', error);
});

