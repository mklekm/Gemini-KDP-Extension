// background.js - V15.0 Service Worker (Strict Locking & Image Proxy)

// Helper to access session storage (falls back to local if session undefined)
const getStorage = async (keys) => {
    if (chrome.storage.session) {
        return await chrome.storage.session.get(keys);
    } else {
        return await chrome.storage.local.get(keys);
    }
};

const setStorage = async (items) => {
    if (chrome.storage.session) {
        return await chrome.storage.session.set(items);
    } else {
        return await chrome.storage.local.set(items);
    }
};

chrome.runtime.onInstalled.addListener(async () => {
    console.log("Gemini KDP Studio V15 Installed");
    // Clear lock on install/update/reload
    await setStorage({ currentJobTabId: null });
});

// Clean up lock if tab is closed
chrome.tabs.onRemoved.addListener(async (tabId) => {
    const { currentJobTabId } = await getStorage(['currentJobTabId']);
    if (tabId === currentJobTabId) {
        console.log("Locked tab closed. Resetting lock.");
        await setStorage({ currentJobTabId: null });
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
        (async () => {
            const { currentJobTabId } = await getStorage(['currentJobTabId']);

            // If no lock, the first requester CLAIMS it.
            if (!currentJobTabId) {
                await setStorage({ currentJobTabId: sender.tab.id });
                console.log(`Tab ${sender.tab.id} claimed the lock.`);
                sendResponse({ allowed: true });
            } else if (currentJobTabId === sender.tab.id) {
                // Same tab, allow.
                sendResponse({ allowed: true });
            } else {
                // Different tab, DENY.
                console.warn(`Tab ${sender.tab.id} denied. Lock held by ${currentJobTabId}.`);
                sendResponse({ allowed: false });
            }
        })();
        return true; // Async now!
    }

    // 3. STOP JOB SIGNAL
    if (msg.action === 'STOP_JOB') {
        (async () => {
             // Broadcast stop
            chrome.tabs.query({}, (tabs) => {
                tabs.forEach(t => chrome.tabs.sendMessage(t.id, { action: 'STOP_JOB' }));
            });

            // Clear lock so new jobs can start
            await setStorage({ currentJobTabId: null });
            console.log("Job stopped. Lock released.");

            // Update storage
            chrome.storage.local.get(['activeJob'], (res) => {
                if (res.activeJob) {
                    res.activeJob.status = 'paused';
                    chrome.storage.local.set({ activeJob: res.activeJob });
                }
            });
        })();
    }
});
