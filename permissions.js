const micStatusEl = document.getElementById('micStatus');
const requestButton = document.getElementById('requestMic');
const refreshButton = document.getElementById('refreshStatus');
const helpEl = document.getElementById('micHelp');
const originEl = document.getElementById('extensionOrigin');
const siteSettingsUrlEl = document.getElementById('siteSettingsUrl');
const extensionIdLabel = document.getElementById('extensionIdLabel');

const extensionOrigin = chrome.runtime.getURL('');
originEl.textContent = extensionOrigin.replace(/\/$/, '');
siteSettingsUrlEl.textContent = 'chrome://settings/content/microphone';
extensionIdLabel.textContent = chrome.runtime.id;

let micPermissionStatus;
let currentState = 'checking';

(async function init() {
  applyMicState('checking');
  await evaluateMicPermission();

  requestButton?.addEventListener('click', requestMicrophone);
  refreshButton?.addEventListener('click', evaluateMicPermission);
})();

async function evaluateMicPermission() {
  if (!navigator.mediaDevices?.getUserMedia) {
    applyMicState('unsupported');
    return;
  }

  if (navigator.permissions?.query) {
    try {
      micPermissionStatus = await navigator.permissions.query({ name: 'microphone' });
      applyMicState(micPermissionStatus.state);
      micPermissionStatus.onchange = () => applyMicState(micPermissionStatus.state);
      return;
    } catch (err) {
      console.warn('[permissions] Unable to query microphone permission:', err);
    }
  }

  // Fallback - assume Chrome will prompt on demand.
  applyMicState('prompt');
}

async function requestMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) {
    applyMicState('unsupported');
    return;
  }

  try {
    applyMicState('requesting');
    if (requestButton) {
      requestButton.disabled = true;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });

    stream.getTracks().forEach(track => track.stop());
    applyMicState('granted');
    await evaluateMicPermission();
  } catch (err) {
    console.warn('[permissions] Microphone request failed:', err);
    applyMicState('denied');
  } finally {
    if (requestButton) {
      requestButton.disabled = requestButton.hidden;
    }
  }
}

function applyMicState(state) {
  currentState = state;

  if (!micStatusEl) return;

  let message = '';
  let messageClass = 'status-message';
  let showHelp = false;
  let showRequest = true;

  switch (state) {
    case 'granted':
      message = 'Microphone ready. The popup can include your mic in recordings.';
      messageClass += ' success';
      showRequest = false;
      break;
    case 'prompt':
      message = 'Click "Request microphone now" and allow the permission when Chrome prompts you.';
      messageClass += ' warning';
      showRequest = true;
      break;
    case 'denied':
      message = 'Chrome is currently blocking the microphone for this extension.';
      messageClass += ' error';
      showHelp = true;
      showRequest = true;
      break;
    case 'requesting':
      message = 'Requesting microphone from Chrome...';
      messageClass += ' warning';
      showRequest = true;
      break;
    case 'unsupported':
      message = 'This browser build does not support requesting microphone access from extensions. Chrome will prompt when you start recording.';
      messageClass += ' warning';
      showRequest = false;
      break;
    case 'checking':
    default:
      message = 'Checking microphone permission...';
      messageClass += ' warning';
      showRequest = false;
      break;
  }

  micStatusEl.className = messageClass;
  micStatusEl.textContent = message;

  if (requestButton) {
    requestButton.hidden = !showRequest;
    requestButton.disabled = requestButton.hidden;
  }

  if (helpEl) {
    helpEl.hidden = !showHelp;
  }
}