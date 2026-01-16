// gemini_bot.js - V14.5 Ultimate Studio (Delimiter Strategy)
(async () => {
    // --- 0. SAFETY & INIT ---
    const allowed = await new Promise(r => chrome.runtime.sendMessage({ action: 'VERIFY_TAB' }, resp => r(resp?.allowed)));
    if (!allowed) {
        console.warn("Gemini KDP: Locked Out - Another tab is active.");
        return;
    }

    if (window.gBotRunning) return;
    window.gBotRunning = true;
    console.log("Gemini KDP Bot V14.5: Started (Delimiter Mode)");

    // --- GLOBALS ---
    let isStopped = false;
    let overlayUI = null;
    let stopListener = null;

    // --- HELPER: OVERLAY UI ---
    function createOverlay(title, color = '#10b981') {
        if (document.getElementById('kdp-overlay')) return document.getElementById('kdp-overlay');
        const div = document.createElement('div');
        div.id = 'kdp-overlay';
        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <div style="width:10px; height:10px; background:${color}; border-radius:50%; box-shadow:0 0 10px ${color}; animation: pulse 2s infinite;"></div>
                    <span style="font-weight:700; font-size:14px; letter-spacing:0.5px; background:linear-gradient(135deg, #a5b4fc, #e879f9); -webkit-background-clip:text; -webkit-text-fill-color:transparent;">${title}</span>
                </div>
                <span id="kdp-status" style="font-size:12px; font-weight:500; color:#94a3b8;">Initializing...</span>
            </div>
            <div style="height:6px; background:rgba(255,255,255,0.1); border-radius:3px; overflow:hidden; margin-bottom:15px;">
                <div id="kdp-bar" style="height:100%; background:linear-gradient(90deg, #6366f1, #d946ef); width:0%; transition:width 0.4s ease;"></div>
            </div>
            <button id="kdp-stop" style="width:100%; padding:8px; background:rgba(239, 68, 68, 0.2); border:1px solid rgba(239, 68, 68, 0.5); border-radius:6px; color:#fca5a5; font-weight:600; font-size:12px; cursor:pointer; transition:all 0.2s;">STOP</button>
        `;
        div.style.cssText = `position:fixed; top:20px; right:20px; width:300px; padding:20px; background:rgba(15,23,42,0.95); backdrop-filter:blur(12px); border:1px solid rgba(255,255,255,0.1); border-radius:16px; box-shadow:0 20px 25px -5px rgba(0,0,0,0.5); font-family:'Inter',sans-serif; color:white; z-index:9999999; animation:slideIn 0.5s ease-out;`;
        const style = document.createElement('style');
        style.innerHTML = `@keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } } @keyframes pulse { 0% { opacity:1; } 50% { opacity:0.6; } 100% { opacity:1; } }`;
        document.head.appendChild(style);
        document.body.appendChild(div);

        stopListener = (msg) => { if (msg.action === 'STOP_JOB') { isStopped = true; updateUI(0, "Stopped by User"); } };
        chrome.runtime.onMessage.addListener(stopListener);

        document.getElementById('kdp-stop').onclick = () => {
            isStopped = true;
            chrome.runtime.sendMessage({ action: 'STOP_JOB' });
        };
        return div;
    }
    function updateUI(pct, txt) {
        const b = document.getElementById('kdp-bar');
        const s = document.getElementById('kdp-status');
        if (b) b.style.width = `${pct}%`;
        if (s) s.innerText = txt;
    }

    // --- DECISION POINT ---
    const storage = await chrome.storage.local.get(['activeJob', 'repairTask', 'projectLibrary']);

    if (storage.repairTask) {
        await executeRepairMode(storage.repairTask, storage.projectLibrary || []);
    } else if (storage.activeJob && storage.activeJob.status !== 'paused') {
        await executeProductionMode(storage.activeJob);
    } else {
        console.log("No active job or repair task found.");
    }

    // ==========================================
    // LOGIC: REPAIR MODE
    // ==========================================
    async function executeRepairMode(task, library) {
        overlayUI = createOverlay("KDP REPAIR", "#facc15");
        updateUI(10, "Initializing...");

        const initialCount = countValidImages();
        await sendPrompt(task.prompt);
        updateUI(30, "Generating...");
        await waitForTextOnly();
        const newImg = await waitForNewImage(initialCount);

        if (newImg) {
            updateUI(80, "Processing...");
            const dataUrl = await fetchImageViaBackground(newImg.src);
            if (dataUrl) {
                const processed = await processImage(dataUrl, task.bookType || 'story');
                const project = library.find(p => p.id === task.projectId);
                if (project) {
                    if (task.pageIndex === -1) project.coverImage = processed;
                    else if (project.pages[task.pageIndex]) project.pages[task.pageIndex].image = processed;

                    await chrome.storage.local.set({ projectLibrary: library });
                    updateUI(100, "Success! Library Updated.");
                } else updateUI(0, "Error: Project not found.");
            } else updateUI(0, "Error: Image Fetch Failed.");
        } else updateUI(0, "Failed: No Image Appeared.");

        await chrome.storage.local.remove('repairTask');
        finish();
    }


    // ==========================================
    // LOGIC: PRODUCTION MODE
    // ==========================================
    async function executeProductionMode(job) {
        overlayUI = createOverlay("KDP STUDIO V14");
        const total = job.settings.pageCount || 10;
        let images = job.images || [];
        let texts = job.storyTexts || [];
        let idx = job.completedPages || 0;
        let sceneData = job.sceneData;

        // --- STEP 0: PLAN ---
        if (!sceneData && idx === 0) {
            updateUI(5, "Planning Story...");
            const ar = getAspectRatioPrompt(job.settings.bookSize);
            const initialPrompt = constructPrompt(job, ar);

            let planAttempts = 0;
            let success = false;

            while (!success && planAttempts < 3 && !isStopped) {
                if (planAttempts === 0) {
                    await sendPrompt(initialPrompt);
                } else {
                    updateUI(5, `Retrying Plan (${planAttempts}/3)...`);
                    await sendPrompt("The previous output was not valid JSON. Please output ONLY the raw JSON array wrapped in <<<JSON>>> delimiters.");
                }

                await waitForTextOnly();
                await delay(2000);

                const lastMsg = getLastBotMessage();
                console.log(`Parsing Plan Candidate (${planAttempts}):`, lastMsg ? lastMsg.slice(0, 50) + "..." : "EMPTY");
                sceneData = parseJSON(lastMsg);

                if (sceneData && Array.isArray(sceneData) && sceneData.length > 0) {
                    success = true;
                    job.sceneData = sceneData;
                    await chrome.storage.local.set({ activeJob: job });
                    updateUI(10, "Plan Secured.");
                } else {
                    console.warn(`Plan Parse Attempt ${planAttempts} Failed.`);
                    planAttempts++;
                }
            }

            if (!success) {
                console.error("Plan Failed after 3 attempts.");
                isStopped = true; updateUI(0, "Plan Failed. See Console.");
                return;
            }
        }

        // --- STEP 1: GENERATION LOOP ---
        for (let i = idx; i < total; i++) {
            if (isStopped) break;
            const progress = Math.round(((i + 1) / total) * 90);
            updateUI(progress, `Generating Page ${i + 1}/${total}`);

            const scene = sceneData[i] || { image_prompt: "Generic Scene", story_text: "..." };
            const prmt = `Scene ${i + 1}: ${scene.image_prompt}. Style: ${job.settings.artStyle}.`;

            let img = null;
            let attempts = 0;

            while (!img && attempts < 3 && !isStopped) {
                const countBefore = countValidImages();
                await sendPrompt(prmt);
                await waitForTextOnly();
                img = await waitForNewImage(countBefore);

                if (!img) {
                    attempts++;
                    console.warn(`Image Timeout (Attempt ${attempts}). Retrying...`);
                    await sendPrompt("Retry. Simple composition.");
                    await delay(5000);
                }
            }

            if (img && img.src) {
                const url = await fetchImageViaBackground(img.src);
                if (url) {
                    const finalB64 = await processImage(url, job.settings.bookType);
                    images.push(finalB64);
                    texts.push(scene.story_text);
                } else { images.push(null); texts.push(scene.story_text); }
            } else { images.push(null); texts.push(scene.story_text); }

            job.completedPages = i + 1;
            job.images = images;
            job.storyTexts = texts;
            await chrome.storage.local.set({ activeJob: job });
            if (i < total - 1) await delay(5000);
        }

        if (isStopped) { updateUI(progress, "Paused."); return; }

        // --- STEP 2: COVER ---
        let cover = null;
        if (job.settings.genCover) {
            updateUI(95, "Generating Cover...");
            const c = countValidImages();
            await sendPrompt(`Design a BOOK COVER for "${job.title}". Style: ${job.settings.artStyle}. High Contrast.`);
            await waitForTextOnly();
            const im = await waitForNewImage(c);
            if (im) {
                const url = await fetchImageViaBackground(im.src);
                if (url) cover = await processImage(url, 'story');
            }
        }

        // --- STEP 3: ARCHIVE ---
        updateUI(98, "Archiving...");
        const newProject = {
            id: job.id || Date.now(),
            title: job.title,
            coverImage: cover,
            settings: job.settings,
            timestamp: new Date().toISOString(),
            pages: job.images.map((img, i) => ({
                page: i + 1,
                image: img,
                text: job.storyTexts[i],
                image_prompt: job.sceneData[i]?.image_prompt
            }))
        };

        const existingLib = (await chrome.storage.local.get('projectLibrary')).projectLibrary || [];
        existingLib.unshift(newProject);
        await chrome.storage.local.set({ projectLibrary: existingLib });
        await chrome.storage.local.remove('activeJob');

        updateUI(100, "Done! Saved to Library.");
        finish();
    }


    // --- UTILS ---

    function countValidImages() {
        return Array.from(document.querySelectorAll('img'))
            .filter(i => i.naturalWidth > 200 && (i.src.startsWith('https://') || i.src.startsWith('data:') || i.src.startsWith('blob:')))
            .length;
    }

    async function waitForTextOnly() {
        // --- V14.4 FIX: STARTUP BUFFER ---
        await delay(3000);

        await new Promise(r => {
            const i = setInterval(() => {
                const stopBtn = document.querySelector('button[aria-label*="Stop"], button[data-test-id*="stop-generating"]');
                const progress = document.querySelector('.mat-mdc-progress-bar, [role="progressbar"]');
                if (!stopBtn && !progress) { clearInterval(i); r(); }
            }, 1000);
        });
    }

    async function waitForNewImage(initialCount) {
        return new Promise(resolve => {
            let attempts = 0;
            const i = setInterval(() => {
                const currentCount = countValidImages();
                if (currentCount > initialCount) {
                    const allImgs = document.querySelectorAll('img');
                    const img = allImgs[allImgs.length - 1];
                    if (img.complete && img.naturalWidth > 200) { clearInterval(i); resolve(img); }
                }
                attempts++;
                if (attempts > 90) { clearInterval(i); resolve(null); }
            }, 1000);
        });
    }

    async function sendPrompt(t) {
        const d = await waitForEl('div[contenteditable="true"], textarea');
        if (!d) { console.error("Input box not found!"); return; }
        d.focus();

        let success = document.execCommand('insertText', false, t);
        if (!success) {
             const inputEvent = new Event('input', { bubbles: true, composed: true });
             if (d.tagName === 'TEXTAREA') d.value = t;
             else d.innerText = t;
             d.dispatchEvent(inputEvent);
        }

        d.dispatchEvent(new Event('input', { bubbles: true }));
        await delay(1500);
        const b = document.querySelector('button[aria-label*="Send"], button[class*="send-button"]');
        if (b) b.click();
        else d.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }

    async function fetchImageViaBackground(u) {
        return new Promise(r => chrome.runtime.sendMessage({ action: 'FETCH_IMAGE', url: u }, res => r(res?.data)));
    }

    async function processImage(u, type) {
        return new Promise(r => {
            const i = new Image();
            i.onload = () => {
                const c = document.createElement('canvas');
                c.width = i.width; c.height = i.height;
                const x = c.getContext('2d');
                x.drawImage(i, 0, 0);
                if (type && type.includes('coloring')) {
                    const d = x.getImageData(0, 0, c.width, c.height);
                    for (let k = 0; k < d.data.length; k += 4) {
                        const avg = (d.data[k] + d.data[k + 1] + d.data[k + 2]) / 3;
                        const v = avg < 150 ? 0 : 255;
                        d.data[k] = d.data[k + 1] = d.data[k + 2] = v;
                    }
                    x.putImageData(d, 0, 0);
                }
                r(c.toDataURL('image/jpeg', 0.9));
            };
            i.onerror = () => r(null);
            i.src = u;
        });
    }

    async function waitForEl(s) {
        return new Promise(r => {
            let k = 0;
            const i = setInterval(() => {
                if (document.querySelector(s)) { clearInterval(i); r(document.querySelector(s)); }
                k++; if (k > 20) { clearInterval(i); r(null); }
            }, 500);
        });
    }

    function constructPrompt(j, a) {
        // --- DELIMITER STRATEGY (V14.5) ---
        // Forces the model to wrap JSON in unique tags, making extraction trivial and robust against UI changes.
        return `Role: Professional Illustrator. Task: Plan ${j.settings.pageCount} generic scene descriptions for a "${j.title}" book. Plot: ${j.description}.
        OUTPUT FORMAT: STRICT JSON Array wrapped in <<<JSON>>> delimiters.
        Example: <<<JSON>>>[{"page":1,"image_prompt":"...","story_text":"..."}]<<<JSON>>>.
        Style Constraint: ${j.settings.bookType.includes('coloring') ? 'Black and white line art only, simple, no shading' : 'Full color, 3D render'}.
        Format: ${a}. Negative Keywords: ${j.negativeKeywords}.`;
    }

    // --- SMART SELECTOR & PARSER (V14.5 Delimiter Edition) ---
    function getLastBotMessage() {
        // Strategy A: Delimiter Search (Full Body Scan - Ultimate Fallback)
        // If we can find the delimiter anywhere in the text, we win.
        if (document.body.innerText.includes('<<<JSON>>>')) {
            const matches = document.body.innerText.match(/<<<JSON>>>([\s\S]*?)<<<JSON>>>/g);
            if (matches && matches.length > 0) {
                // Return the last match found in the entire document
                return matches[matches.length - 1];
            }
        }

        // Strategy B: Standard Selector Search (Backwards)
        const selectors = [
            '.model-response-text',
            '.markdown',
            '.message-content',
            '[data-test-id="model-response-message"]',
            '[data-message-author-role="assistant"]'
        ];

        for (const sel of selectors) {
            const els = document.querySelectorAll(sel);
            if (els.length > 0) {
                for (let i = els.length - 1; i >= 0; i--) {
                    const txt = els[i].innerText;
                    if (txt && txt.length > 20 && !txt.includes("Role: Professional Illustrator")) {
                        return txt;
                    }
                }
            }
        }

        return "";
    }

    function parseJSON(s) {
        if (!s) return null;

        // 1. Delimiter Extraction (Highest Priority)
        const delimMatch = s.match(/<<<JSON>>>([\s\S]*?)<<<JSON>>>/);
        if (delimMatch && delimMatch[1]) {
            try { return JSON.parse(delimMatch[1]); } catch(e) { console.warn("Delimiter JSON parse failed"); }
        }

        // 2. Code Block Extraction
        const codeBlockMatch = s.match(/```(?:json)?\s*(\[\s*\{[\s\S]*?\}\s*\])\s*```/i);
        if (codeBlockMatch && codeBlockMatch[1]) {
             try { return JSON.parse(codeBlockMatch[1]); } catch(e) {}
        }

        // 3. Raw Search
        const start = s.indexOf('[');
        const end = s.lastIndexOf(']') + 1;
        if (start !== -1 && end > start) {
            try { return JSON.parse(s.substring(start, end)); } catch (e) { }
        }
        return null;
    }

    function getAspectRatioPrompt(s) { return s.startsWith('8.5') ? "Portrait 3:4" : "Landscape 4:3"; }
    async function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
    function finish() { setTimeout(() => { if (overlayUI) overlayUI.remove(); window.gBotRunning = false; }, 5000); }

})();
