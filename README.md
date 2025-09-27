### Title: Meet Speaker Insights Extension

This is a Chrome extension that records the audio from a Google Meet tab and generates a structured JSON timeline of speaker activity.

It also includes a PowerShell script that creates a verification video from the output files.

This is a work in progress and is not yet ready for production.

---

### Acknowledgments

This project was inspired by and builds upon the excellent work from [chrome-recorder-extension](https://github.com/shebisabeen/chrome-recorder-extension) by [@shebisabeen](https://github.com/shebisabeen). The core audio recording methodology and Chrome extension architecture were adapted from that project and enhanced with Google Meet-specific speaker detection capabilities.

---

### TL;DR (The Bottom Line)

- **Goal:** Install and use the Meet Speaker Insights Chrome extension to record Google Meet audio and generate a structured JSON timeline of speaker activity. Optionally, create a verification video from the output files.
- **Use When:** You need to analyze communication patterns, such as speaking time or interruptions, in a Google Meet session for self-improvement or team dynamics analysis.
- **Time:** ~5-10 minutes for setup. Recording time is dependent on meeting length.

---

### 1. BEFORE YOU START (Prerequisites)

- **Purpose:** This document provides instructions for setting up the Meet Speaker Insights extension, recording a meeting, and using the provided PowerShell script to verify the output. The extension works by monitoring the Google Meet user interface to detect active speakers and capturing tab audio.
- **Access:** N/A
- **Tools:**
  - Google Chrome (v116 or newer)
  - PowerShell (for the verification script on Windows)
  - FFmpeg (must be installed and added to your system's PATH for the verification script)
- **Secrets:** N/A

---

### 2. STEP-BY-STEP PROCEDURE

> **IMPORTANT:** Follow these steps in order to ensure a successful setup. The procedure is divided into three parts: setting up the extension, recording a meeting, and optionally creating a verification video.

### Part 1: Extension Setup

#### Step 1: Download and Unpack the Source Code

This step prepares the extension files for installation in your browser.

1.  Obtain the complete source code for the project.
2.  If it is a `.zip` archive, extract it to a permanent folder on your computer (e.g., `C:\Users\YourUser\Documents\chrome-extensions\meet-insights`).

#### Step 2: Load the Extension in Chrome

This step installs the unpacked extension in your browser using Developer Mode.

1.  Open the Google Chrome browser.
2.  Navigate to the extensions page by entering `chrome://extensions` in the address bar.
3.  Enable the **Developer mode** toggle, located in the top-right corner of the page.
4.  Click the **Load unpacked** button that appears on the top-left.
5.  In the file selection dialog, navigate to and select the folder where you extracted the source code.

**Verification:** The "Meet Speaker Insights" extension card appears on the `chrome://extensions` page. You should also see its icon in the Chrome toolbar.

### Part 2: Recording a Meeting

#### Step 3: Start a Recording

This step initiates the audio capture and speaker tracking for an active Google Meet tab.

1.  Join a Google Meet call.
2.  Click the **Meet Speaker Insights** icon in your Chrome toolbar to open the popup.
3.  (Optional) Check the **Include my microphone in recording** box if you want your own audio captured.
    - If microphone permission has not been granted, the popup will guide you to allow it.
4.  Click the **Start Recording** button.

**Verification:** The extension icon in the toolbar changes from the default icon to a red recording symbol.

#### Step 4: Stop Recording and Download Files

This step finalizes the recording and downloads the audio and timeline files.

1.  Click the red recording icon in the Chrome toolbar to open the popup.
2.  Click the **Stop Recording** button.
3.  Your browser will automatically download two files to your default 'Downloads' folder:
    - `meeting_audio.webm`
    - `speaker_timeline.json`

**Verification:** Check your browser's download manager or your 'Downloads' folder for the two generated files.

### Part 3: (Optional) Creating a Verification Video

This part is for Windows users who want to visually verify the accuracy of the speaker timeline against the audio.

#### Step 5: Verify FFmpeg Installation

This step ensures the `verification-video.ps1` script can find and use FFmpeg.

```powershell
# Open a PowerShell terminal and run this command.
Get-Command ffmpeg
```

**Verification:** PowerShell should output the path to the `ffmpeg.exe` executable. If it returns an error, you must install FFmpeg and add its `bin` directory to your system's PATH environment variable.

#### Step 6: Run the Verification Script

This step runs a PowerShell script that uses FFmpeg to create an MP4 video file, overlaying the speaker names from the JSON file onto a black screen, synchronized with the meeting audio.

1.  Open a PowerShell terminal.
2.  Navigate to the directory containing the project files, including `verification-video.ps1`.
3.  Run the script, providing the full paths to the downloaded audio and JSON files.

```powershell
# Replace the placeholder paths with the actual paths to your downloaded files.
.\verification-video.ps1 -JsonPath "<PATH_TO_YOUR_DOWNLOADS>\speaker_timeline.json" -AudioPath "<PATH_TO_YOUR_DOWNLOADS>\meeting_audio.webm"
```

**Verification:** A video file named `verification_video.mp4` is created in the script's directory. Playing this video will show a black screen with speaker names appearing and disappearing in sync with the audio.

---

### 3. FINAL VALIDATION (Definition of Done)

- [ ] The `meeting_audio.webm` file has been downloaded and plays the meeting's audio correctly.
- [ ] The `speaker_timeline.json` file has been downloaded and contains a structured list of speaker events with start and end times.
- [ ] (Optional) The `verification_video.mp4` plays correctly and visually displays the speaker names synchronized with the audio track.

---

### 4. TROUBLESHOOTING & ROLLBACK

- **If things go wrong (Rollback):**

  - To completely uninstall the extension, navigate to `chrome://extensions`, find the "Meet Speaker Insights" card, and click **Remove**.

- **Common Problems:**
  - **Symptom:** The extension does not seem to detect any speakers, and the JSON file only shows "SILENCE".
    - **Fix:** This extension relies on specific HTML structure (DOM selectors) in the Google Meet interface. If Google updates its web application, these selectors can break. The extension's `content_script.js` file would need to be updated with the new selectors. This makes the extension fragile and dependent on Meet's UI stability.
  - **Symptom:** My microphone was not included in the recording.
    - **Fix:** Ensure you checked the "Include my microphone" box before starting the recording. If the browser blocked the permission, use the **Open permission helper** button in the popup to diagnose and fix the issue. You may need to manually allow microphone access for the extension in Chrome's site settings.
  - **Error:** In PowerShell: `ffmpeg was not found in your system's PATH.`
    - **Fix:** You must install FFmpeg on your system and add the folder containing `ffmpeg.exe` (usually a `bin` folder) to your system's PATH environment variable so that PowerShell can find it.

---

### Appendix: Application Flow (Mind Map)

This section outlines the architecture and data flow of the extension.

1.  **User Interaction (popup.js & popup.html)**

    - User clicks the extension icon, opening `popup.html`.
    - User clicks "Start Recording".
    - `popup.js` sends a `start-recording` message to the `offscreen.js` document.
    - User clicks "Stop Recording".
    - `popup.js` sends a `stop-recording` message to `offscreen.js`.

2.  **Audio Recording (offscreen.js)**

    - Receives `start-recording` message.
    - Uses `chrome.tabCapture` to get the audio stream from the active Google Meet tab.
    - (Optional) Uses `navigator.mediaDevices.getUserMedia` to get the user's microphone stream.
    - Mixes the audio streams using the Web Audio API.
    - Records the mixed stream using `MediaRecorder`.
    - Sends a `recording-started` message to `service-worker.js`.
    - Receives `stop-recording` message.
    - Stops the `MediaRecorder`, creates a `.webm` audio blob, and sends a `download-recording` message to the service worker.

3.  **Speaker Detection (content_script.js)**

    - Runs only on `meet.google.com` pages.
    - Receives `start-tracking` message from the service worker.
    - Uses a `MutationObserver` to efficiently watch for changes in the Google Meet DOM.
    - When changes occur, it checks for specific CSS classes (`BlxGDf`) and selectors that indicate an active speaker.
    - It extracts the speaker's name from the corresponding DOM element.
    - When the list of active speakers changes, it sends a `speaker-update` message to `service-worker.js` with the names of the current speakers.

4.  **State & Timeline Management (service-worker.js)**
    - Receives `recording-started` message.
      - Initializes the timeline with a "SILENCE" event.
      - Sends a `start-tracking` message to `content_script.js`.
    - Receives `speaker-update` messages.
      - Calculates the elapsed time since the recording started.
      - Closes the previous speaker event in the timeline by setting its `end` time.
      - Adds a new event to the timeline with the new speaker(s) and a `start` time.
    - Receives `recording-stopped` message from `offscreen.js`.
      - Finalizes the last event in the timeline.
      - Creates a `.json` file from the timeline data and triggers a download using the `chrome.downloads` API.
      - Sends a `stop-tracking` message to `content_script.js`.
    - Receives `download-recording` message from `offscreen.js` and triggers the download of the `.webm` file.
