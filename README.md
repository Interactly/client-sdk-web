# Interactly Web SDK

This package lets you listen to events in calls directly in your webapp.


## Usage


First, Add it in dependencies
```json
"dependencies": {
        "@interactly-ai/web": "file:../client-sdk-web",
}
```

Import the Interactly class from the package:

```javascript
import Interactly from '@interaclty-ai/web';
```

Then, create a new instance of the Interactly class, passing your Public Key as a parameter to the constructor:

```javascript
const Interactly = new Interactly('your-public-key', 'api-base-url');
```

You can start a listening to a call by calling the `start` method and passing an `callSid`:

```javascript
Interactly.start('your-callSid');
```

```javascript

Interactly.start('your-assistant-id');
```

You can stop the session by calling the `stop` method:

```javascript
Interactly.stop();
```

This will stop the events listening and close the connection.


## Events

You can listen to the following events:

```javascript

Interactly.on('call-start', () => {
  console.log('Call has started');
});

Interactly.on('call-end', () => {
  console.log('Call has stopped');
});


// Function calls and transcripts will be sent via messages
Interactly.on('message', (message) => {
  console.log(message);
});

Interactly.on('error', (e) => {
  console.error(e);
});
```

These events allow you to react to changes in the state of the call or speech.

## License

```
MIT License

2024 (c) interactly.ai

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```