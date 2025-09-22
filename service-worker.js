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
