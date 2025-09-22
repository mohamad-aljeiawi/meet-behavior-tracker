# icons\icon-16.png

This is a binary file of the type: Image

# icons\icon-32.png

This is a binary file of the type: Image

# icons\icon-128.png

This is a binary file of the type: Image

# icons\not-recording.png

This is a binary file of the type: Image

# icons\recording.png

This is a binary file of the type: Image

# manifest.json

```json
{
  "manifest_version": 3,
  "name": "Meet Speaker Insights",
  "version": "0.1.0",
  "description": "Popup to capture Google Meet tab audio for diarization and insights.",
  "minimum_chrome_version": "116",

  "icons": {
    "16": "icons/icon-16.png",
    "32": "icons/icon-32.png",
    "128": "icons/icon-128.png"
  },

  "action": {
    "default_title": "Open Meet Speaker Insights",
    "default_icon": "icons/icon-16.png",
    "default_popup": "popup.html"
  },

  "background": {
    "service_worker": "service-worker.js"
  },

  "permissions": [
    "tabCapture",
    "offscreen",
    "activeTab",
    "storage",
    "downloads"
  ],

  "host_permissions": [
    "https://meet.google.com/*"
  ]
}

```

# offscreen.html

```html
<!DOCTYPE html>
<html>
  <head>
    <title>Offscreen – Meet Audio Recorder</title>
  </head>
  <body>
    <script src="offscreen.js"></script>
  </body>
</html>

```

# offscreen.js

```js
let recorder;
let activeStream = null;
let chunks = [];

chrome.runtime.onMessage.addListener(async (message) => {
  if (message.target !== "offscreen") return;
  switch (message.type) {
    case "start-recording":
      await startRecording(message.data);
      break;
    case "stop-recording":
      await stopRecording();
      break;
    default:
      console.warn("[offscreen] Unknown message:", message.type);
  }
});

async function startRecording(streamId) {
  if (recorder?.state === "recording") {
    throw new Error("startRecording called while already recording");
  }

  // Ensure any previous stream is closed
  await stopAllTracks();
  chunks = [];

  try {
    // Acquire TAB audio only (no microphone)
    const tabStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId
        }
      },
      video: false
    });

    activeStream = tabStream;

    // Record tab stream directly (no AudioContext mixing, no echo)
    recorder = new MediaRecorder(tabStream, {
      mimeType: "audio/webm;codecs=opus"
    });

    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) {
        chunks.push(ev.data);
      }
    };

    recorder.onstop = async () => {
      try {
        const blob = new Blob(chunks, { type: "audio/webm" });
        const url = URL.createObjectURL(blob);

        // Prefer Chrome downloads API for better UX
        const filename = `meet-audio-${new Date().toISOString().replace(/[:]/g, "-")}.webm`;
        try {
          await chrome.downloads.download({ url, filename, saveAs: true });
        } finally {
          URL.revokeObjectURL(url);
        }
      } catch (err) {
        console.error("[offscreen] Finalize error:", err);
        chrome.runtime.sendMessage({
          type: "recording-error",
          target: "popup",
          error: err?.message || String(err)
        });
      } finally {
        recorder = undefined;
        chunks = [];
        await stopAllTracks();
        window.location.hash = "";
        chrome.runtime.sendMessage({ type: "recording-stopped", target: "service-worker" });
      }
    };

    // Start recording; optional timeslice emits smaller chunks to keep UI responsive
    recorder.start(1000);
    window.location.hash = "recording";
    chrome.runtime.sendMessage({ type: "update-icon", target: "service-worker", recording: true });
  } catch (error) {
    console.error("[offscreen] Error starting recording:", error);
    chrome.runtime.sendMessage({ type: "recording-error", target: "popup", error: error.message });
  }
}

async function stopRecording() {
  try {
    if (recorder && recorder.state === "recording") {
      recorder.stop();
    } else {
      // No active recording, ensure cleanup
      await stopAllTracks();
      window.location.hash = "";
      chrome.runtime.sendMessage({ type: "update-icon", target: "service-worker", recording: false });
    }
  } catch (err) {
    console.error("[offscreen] stopRecording error:", err);
  }
}

async function stopAllTracks() {
  try {
    if (activeStream) {
      activeStream.getTracks().forEach(t => t.stop());
      activeStream = null;
    }
    // Small delay to let tracks settle
    await new Promise(r => setTimeout(r, 80));
  } catch (err) {
    console.warn("[offscreen] stopAllTracks warn:", err);
  }
}

```

# popup.html

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { width: 220px; padding: 12px; display: flex; flex-direction: column; gap: 10px; font-family: system-ui, Arial; }
      .button-container { position: relative; height: 40px; }
      button { position: absolute; width: 100%; height: 40px; border: none; border-radius: 6px; font-size: 14px; cursor: pointer; opacity: 0; transition: opacity .25s ease; }
      button.visible { opacity: 1; }
      #startRecord { background: #4caf50; color: #fff; display: none; }
      #stopRecord { background: #f44336; color: #fff; display: none; }
      small { color: #666; }
    </style>
  </head>
  <body>
    <div class="button-container">
      <button id="startRecord">Start Recording (tab)</button>
      <button id="stopRecord">Stop Recording</button>
    </div>
    <small>Captures active tab audio only (no microphone).</small>
    <script src="popup.js"></script>
  </body>
</html>

```

# popup.js

```js
const startButton = document.getElementById("startRecord");
const stopButton  = document.getElementById("stopRecord");

async function showByState() {
  const contexts = await chrome.runtime.getContexts({});
  const offscreenDoc = contexts.find(c => c.contextType === "OFFSCREEN_DOCUMENT");
  const isRecording = !!(offscreenDoc && offscreenDoc.documentUrl.endsWith('#recording'));

  if (isRecording) {
    startButton.style.display = 'none';
    stopButton.style.display  = 'block';
    setTimeout(() => stopButton.classList.add('visible'), 10);
  } else {
    stopButton.style.display  = 'none';
    startButton.style.display = 'block';
    setTimeout(() => startButton.classList.add('visible'), 10);
  }
}

document.addEventListener('DOMContentLoaded', showByState);

startButton.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
      alert('Cannot record Chrome system pages. Open Google Meet or any regular tab.');
      return;
    }

    // Ensure offscreen is created
    const contexts = await chrome.runtime.getContexts({});
    const offscreenDoc = contexts.find(c => c.contextType === 'OFFSCREEN_DOCUMENT');
    if (!offscreenDoc) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['AUDIO_PLAYBACK_CAPTURE'],
        justification: 'Capture tab audio via tabCapture for Meet insights.'
      });
    }

    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    await chrome.runtime.sendMessage({ type: 'start-recording', target: 'offscreen', data: streamId });

    startButton.classList.remove('visible');
    setTimeout(() => { startButton.style.display = 'none'; stopButton.style.display = 'block'; setTimeout(() => stopButton.classList.add('visible'), 10); }, 250);
  } catch (err) {
    console.error('[popup] start error:', err);
    alert('Failed to start: ' + (err?.message || String(err)));
  }
});

stopButton.addEventListener('click', async () => {
  try {
    await chrome.runtime.sendMessage({ type: 'stop-recording', target: 'offscreen' });
    stopButton.classList.remove('visible');
    setTimeout(() => { stopButton.style.display = 'none'; startButton.style.display = 'block'; setTimeout(() => startButton.classList.add('visible'), 10); }, 250);
  } catch (err) {
    console.error('[popup] stop error:', err);
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.target !== 'popup') return;
  switch (message.type) {
    case 'recording-error':
      alert(message.error);
      showByState();
      break;
    case 'recording-stopped':
      showByState();
      break;
  }
});

```

# README.md

```md

```

# service-worker.js

```js
chrome.runtime.onMessage.addListener(async (message) => {
  if (message.target !== 'service-worker') return;
  switch (message.type) {
    case 'recording-stopped':
      chrome.action.setIcon({ path: 'icons/not-recording.png' });
      break;
    case 'update-icon':
      chrome.action.setIcon({ path: message.recording ? 'icons/recording.png' : 'icons/not-recording.png' });
      break;
    default:
      // no-op
      break;
  }
});

```

