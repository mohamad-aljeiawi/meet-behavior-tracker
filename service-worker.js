chrome.runtime.onMessage.addListener(async (message) => {
  if (message.target !== 'service-worker') return;
  switch (message.type) {
    case 'recording-stopped':
      chrome.action.setIcon({ path: 'icons/not-recording.png' });
      break;
    case 'update-icon':
      chrome.action.setIcon({ path: message.recording ? 'icons/recording.png' : 'icons/not-recording.png' });
      break;
    case 'download-recording':
      try {
        await chrome.downloads.download({ 
          url: message.url, 
          filename: message.filename, 
          saveAs: false
        });
        // Clean up the blob URL after a short delay
        setTimeout(() => {
          URL.revokeObjectURL(message.url);
        }, 1000);
      } catch (err) {
        console.error('[service-worker] Download error:', err);
      }
      break;
    default:
      // no-op
      break;
  }
});
