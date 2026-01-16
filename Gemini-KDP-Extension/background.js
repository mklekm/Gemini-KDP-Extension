// background.js - V12 Service Worker (Strict Locking & Image Proxy)

let currentJobTabId = null;

chrome.runtime.onInstalled.addListener(() => {
    console.log("Gemini KDP Studio V12 Installed");
});

// Clean up lock if tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === currentJobTabId) {
        console.log("Locked tab closed. Resetting lock.");
        currentJobTabId = null;
    }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

    // 1. FETCH IMAGE (CSP BYPASS)
    if (msg.action === 'FETCH_IMAGE') {
        fetch(msg.url)
            .then(r => r.blob())
            .then(blob => {
                const reader = new FileReader();
                reader.onloadend = () => sendResponse({ success: true, data: reader.result });
                reader.onerror = () => sendResponse({ success: false, error: "Reader failed" });
                reader.readAsDataURL(blob);
            })
            .catch(e => {
                console.error("BG Fetch Error:", e);
                sendResponse({ success: false, error: e.message });
            });
        return true; // Async
    }

    // 2. STRICT TAB LOCKING
    if (msg.action === 'VERIFY_TAB') {
        // If no lock, the first requester CLAIMS it.
        // In a perfect world, popup would set this, but content script is fine for this flow.
        if (currentJobTabId === null) {
            currentJobTabId = sender.tab.id;
            console.log(`Tab ${currentJobTabId} claimed the lock.`);
            sendResponse({ allowed: true });
        } else if (currentJobTabId === sender.tab.id) {
            // Same tab, allow.
            sendResponse({ allowed: true });
        } else {
            // Different tab, DENY.
            console.warn(`Tab ${sender.tab.id} denied. Lock held by ${currentJobTabId}.`);
            sendResponse({ allowed: false });
        }
        return false;
    }

    // 3. STOP JOB SIGNAL
    if (msg.action === 'STOP_JOB') {
        // Broadcast stop
        chrome.tabs.query({}, (tabs) => {
            tabs.forEach(t => chrome.tabs.sendMessage(t.id, { action: 'STOP_JOB' }));
        });

        // Clear lock so new jobs can start
        currentJobTabId = null;
        console.log("Job stopped. Lock released.");

        // Update storage
        chrome.storage.local.get(['activeJob'], (res) => {
            if (res.activeJob) {
                res.activeJob.status = 'paused';
                chrome.storage.local.set({ activeJob: res.activeJob });
            }
        });
    }
});
