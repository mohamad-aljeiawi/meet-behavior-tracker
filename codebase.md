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
  "description": "Side panel for Google Meet speaker insights (Lit + Tailwind v4)",
  "icons": {
    "16": "public/icon-16.png",
    "32": "public/icon-32.png",
    "128": "public/icon-128.png"
  },
  "minimum_chrome_version": "116",
  "action": {
    "default_title": "Open Meet Speaker Insights",
    "default_icon": "public/icon-16.png",
    "default_popup": "popup.html"
  },
  "background": {
    "service_worker": "service-worker.js"
  },
  "permissions": ["tabCapture", "offscreen", "activeTab", "storage"],
  "host_permissions": ["https://meet.google.com/*"],
  "web_accessible_resources": [
    {
      "resources": ["permission.html", "offscreen.html"],
      "matches": ["<all_urls>"]
    }
  ]
}

```

# offscreen.html

```html
<!DOCTYPE html>
<html>
  <head>
    <title>Recording Handler</title>
  </head>
  <body>
    <script src="offscreen.js"></script>
  </body>
</html>

```

# offscreen.js

```js
let recorder;
let data = [];
let activeStreams = [];

chrome.runtime.onMessage.addListener(async (message) => {
  if (message.target === "offscreen") {
    switch (message.type) {
      case "start-recording":
        startRecording(message.data);
        break;
      case "stop-recording":
        stopRecording();
        break;
      default:
        throw new Error("Unrecognized message:", message.type);
    }
  }
});

async function startRecording(streamId) {
  if (recorder?.state === "recording") {
    throw new Error("Called startRecording while recording is in progress.");
  }

  await stopAllStreams();

  try {
    // Get tab audio stream
    const tabStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
        },
      },
      video: false,
    });

    // Get microphone stream with noise cancellation
    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });

    activeStreams.push(tabStream, micStream);

    // Create audio context
    const audioContext = new AudioContext();

    // Create sources and destination
    const tabSource = audioContext.createMediaStreamSource(tabStream);
    const micSource = audioContext.createMediaStreamSource(micStream);
    const destination = audioContext.createMediaStreamDestination();

    // Create gain nodes
    const tabGain = audioContext.createGain();
    const micGain = audioContext.createGain();

    // Set gain values
    tabGain.gain.value = 1.0; // Normal tab volume
    micGain.gain.value = 1.5; // Slightly boosted mic volume

    // Connect tab audio to both speakers and recorder
    tabSource.connect(tabGain);
    tabGain.connect(audioContext.destination);
    tabGain.connect(destination);

    // Connect mic to recorder only (prevents echo)
    micSource.connect(micGain);
    micGain.connect(destination);

    // Start recording
    recorder = new MediaRecorder(destination.stream, {
      mimeType: "audio/webm",
    });
    recorder.ondataavailable = (event) => data.push(event.data);
    recorder.onstop = () => {
      const blob = new Blob(data, { type: "audio/webm" });
      const url = URL.createObjectURL(blob);

      // Create temporary link element to trigger download
      const downloadLink = document.createElement("a");
      downloadLink.href = url;
      downloadLink.download = `recording-${new Date().toISOString()}.webm`;
      downloadLink.click();

      // Cleanup
      URL.revokeObjectURL(url);
      recorder = undefined;
      data = [];

      chrome.runtime.sendMessage({
        type: "recording-stopped",
        target: "service-worker",
      });
    };

    recorder.start();
    window.location.hash = "recording";

    chrome.runtime.sendMessage({
      type: "update-icon",
      target: "service-worker",
      recording: true,
    });
  } catch (error) {
    console.error("Error starting recording:", error);
    chrome.runtime.sendMessage({
      type: "recording-error",
      target: "popup",
      error: error.message,
    });
  }
}

async function stopRecording() {
  if (recorder && recorder.state === "recording") {
    recorder.stop();
  }

  await stopAllStreams();
  window.location.hash = "";

  chrome.runtime.sendMessage({
    type: "update-icon",
    target: "service-worker",
    recording: false,
  });
}

async function stopAllStreams() {
  activeStreams.forEach((stream) => {
    stream.getTracks().forEach((track) => {
      track.stop();
    });
  });

  activeStreams = [];
  await new Promise((resolve) => setTimeout(resolve, 100));
}

```

# permission.html

```html
<!DOCTYPE html>
<html>
  <head>
    <title>Audio Recorder - Permission Request</title>
    <style>
      body {
        font-family: Arial, sans-serif;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        margin: 0;
        background-color: #f5f5f5;
      }
      .container {
        background: white;
        padding: 30px;
        border-radius: 8px;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
        text-align: center;
        max-width: 500px;
      }
      .button {
        background-color: #4285f4;
        color: white;
        border: none;
        padding: 12px 24px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 16px;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Microphone Permission Required</h1>
      <p>
        To record audio, this extension needs permission to use your microphone.
      </p>
      <button id="requestPermission" class="button">
        Allow Microphone Access
      </button>
      <p id="status"></p>
    </div>
    <script src="permission.js"></script>
  </body>
</html>

```

# permission.js

```js
document
  .getElementById("requestPermission")
  .addEventListener("click", async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());

      document.getElementById("status").textContent =
        "Permission granted! You can close this tab.";

      setTimeout(() => {
        window.close();
      }, 2000);
    } catch (error) {
      document.getElementById("status").textContent =
        "Permission denied. Please try again.";
    }
  });

```

# popup.html

```html
<!DOCTYPE html>
<html>
  <head>
    <style>
      body {
        width: 200px;
        padding: 10px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      button {
        padding: 10px;
        font-size: 14px;
        cursor: pointer;
        border: none;
        border-radius: 4px;
        width: 100%;
        opacity: 0; /* Start with 0 opacity */
        transition: opacity 0.3s ease-in-out; /* Smooth transition for opacity */
        position: absolute; /* Prevent layout shifting */
      }

      #startRecord {
        background: #4caf50;
        color: white;
        display: none;
      }

      #stopRecord {
        background: #f44336;
        color: white;
        display: none;
      }

      /* New class for visible buttons */
      button.visible {
        opacity: 1;
      }

      /* Add a container for the buttons to maintain layout */
      .button-container {
        position: relative;
        height: 38px; /* Height of your buttons */
        margin: 10px 0;
      }

      button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      #permissionStatus {
        margin: 10px 0;
        padding: 10px;
        border-radius: 4px;
        display: none;
        background-color: #fff3e0;
        color: #ef6c00;
      }
    </style>
  </head>
  <body>
    <div id="permissionStatus"></div>
    <div class="button-container">
      <button id="startRecord">Start Recording</button>
      <button id="stopRecord">Stop Recording</button>
    </div>
    <script src="popup.js"></script>
  </body>
</html>

```

# popup.js

```js
// Get button elements
const startButton = document.getElementById("startRecord");
const stopButton = document.getElementById("stopRecord");

let permissionStatus = document.getElementById("permissionStatus");

function showError(message) {
  permissionStatus.textContent = message;
  permissionStatus.style.display = "block";
}

function hideError() {
  permissionStatus.style.display = "none";
}

async function checkMicrophonePermission() {
  try {
    await navigator.mediaDevices.getUserMedia({ audio: true });
    return true;
  } catch (error) {
    return false;
  }
}

// Check recording state when popup opens
async function checkRecordingState() {
  const hasPermission = await checkMicrophonePermission();
  if (!hasPermission) {
    chrome.tabs.create({ url: "permission.html" });
    return;
  }

  const contexts = await chrome.runtime.getContexts({});
  const offscreenDocument = contexts.find(
    (c) => c.contextType === "OFFSCREEN_DOCUMENT"
  );

  if (
    offscreenDocument &&
    offscreenDocument.documentUrl.endsWith("#recording")
  ) {
    stopButton.style.display = "block";
    setTimeout(() => stopButton.classList.add("visible"), 10);
  } else {
    startButton.style.display = "block";
    setTimeout(() => startButton.classList.add("visible"), 10);
  }
}

// Call checkRecordingState when popup opens
document.addEventListener("DOMContentLoaded", checkRecordingState);

// Add button click listeners
startButton.addEventListener("click", async () => {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (
      !tab ||
      tab.url.startsWith("chrome://") ||
      tab.url.startsWith("chrome-extension://")
    ) {
      alert(
        "Cannot record Chrome system pages. Please try on a regular webpage."
      );
      return;
    }

    // Create offscreen document if not exists
    const contexts = await chrome.runtime.getContexts({});
    const offscreenDocument = contexts.find(
      (c) => c.contextType === "OFFSCREEN_DOCUMENT"
    );

    if (!offscreenDocument) {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["USER_MEDIA"],
        justification: "Recording from chrome.tabCapture API",
      });
    }

    // Get stream ID and start recording
    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tab.id,
    });

    chrome.runtime.sendMessage({
      type: "start-recording",
      target: "offscreen",
      data: streamId,
    });

    startButton.classList.remove("visible");
    setTimeout(() => {
      startButton.style.display = "none";
      stopButton.style.display = "block";
      setTimeout(() => stopButton.classList.add("visible"), 10);
    }, 300);
  } catch (error) {
    alert("Failed to start recording: " + error.message);
  }
});

stopButton.addEventListener("click", () => {
  setTimeout(() => {
    chrome.runtime.sendMessage({
      type: "stop-recording",
      target: "offscreen",
    });
  }, 500);

  stopButton.classList.remove("visible");
  setTimeout(() => {
    stopButton.style.display = "none";
    startButton.style.display = "block";
    setTimeout(() => startButton.classList.add("visible"), 10);
  }, 300);
});

// Listen for messages from offscreen document and service worker
chrome.runtime.onMessage.addListener((message) => {
  if (message.target === "popup") {
    switch (message.type) {
      case "recording-error":
        alert(message.error);
        startButton.style.display = "block";
        stopButton.style.display = "none";
        break;
      case "recording-stopped":
        startButton.style.display = "block";
        stopButton.style.display = "none";
        break;
    }
  }
});

```

# README.md

```md

```

# service-worker.js

```js
chrome.runtime.onMessage.addListener(async (message) => {
  if (message.target === "service-worker") {
    switch (message.type) {
      case "request-recording":
        try {
          const [tab] = await chrome.tabs.query({
            active: true,
            currentWindow: true,
          });

          // Check if we can record this tab
          if (
            !tab ||
            tab.url.startsWith("chrome://") ||
            tab.url.startsWith("chrome-extension://")
          ) {
            chrome.runtime.sendMessage({
              type: "recording-error",
              target: "offscreen",
              error:
                "Cannot record Chrome system pages. Please try on a regular webpage.",
            });
            return;
          }

          // Ensure we have access to the tab
          await chrome.tabs.update(tab.id, {});

          // Get a MediaStream for the active tab
          const streamId = await chrome.tabCapture.getMediaStreamId({
            targetTabId: tab.id,
          });

          // Send the stream ID to the offscreen document to start recording
          chrome.runtime.sendMessage({
            type: "start-recording",
            target: "offscreen",
            data: streamId,
          });

          chrome.action.setIcon({ path: "/icons/recording.png" });
        } catch (error) {
          chrome.runtime.sendMessage({
            type: "recording-error",
            target: "offscreen",
            error: error.message,
          });
        }
        break;

      case "recording-stopped":
        chrome.action.setIcon({ path: "icons/not-recording.png" });
        break;

      case "update-icon":
        chrome.action.setIcon({
          path: message.recording
            ? "icons/recording.png"
            : "icons/not-recording.png",
        });
        break;
    }
  }
});

```

