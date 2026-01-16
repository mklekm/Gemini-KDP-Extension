// popup.js - V15.0 Ultimate Studio Controller
document.addEventListener('DOMContentLoaded', async () => {

    // --- UI REFERENCES ---
    const els = {
        tabs: document.querySelectorAll('.tab-btn'),
        contents: document.querySelectorAll('.tab-content'),

        // Inputs
        url: document.getElementById('amazon-url'),
        title: document.getElementById('book-title'),
        author: document.getElementById('book-author'),
        plot: document.getElementById('story-plot'),
        pages: document.getElementById('page-count'),
        style: document.getElementById('art-style'),
        size: document.getElementById('book-size'),
        cover: document.getElementById('gen-cover'),

        // Buttons
        btnScrape: document.getElementById('btn-scrape'),
        btnStart: document.getElementById('btn-start'),
        btnStop: document.getElementById('btn-stop'),

        // Resume UI
        resumeAlert: document.getElementById('resume-alert'),
        btnResume: document.getElementById('btn-resume'),
        btnDiscard: document.getElementById('btn-discard'),

        // Library UI
        libraryList: document.getElementById('library-list'),
        emptyLib: document.getElementById('empty-lib'),
        libGridView: document.getElementById('lib-grid-view'),
        projectView: document.getElementById('project-view'),
        projPages: document.getElementById('proj-pages'),
        projTitle: document.getElementById('proj-title'),
        btnBackLib: document.getElementById('btn-back-lib'),
        btnExportPdf: document.getElementById('btn-export-pdf')
    };

    // --- 1. INITIALIZATION & RESUME LOGIC ---
    // Load storage to check state
    const storage = await chrome.storage.local.get(['activeJob', 'projectLibrary', 'repairTask', 'negativeKeywords']);
    const library = storage.projectLibrary || [];

    // Check for Paused Job
    if (storage.activeJob && storage.activeJob.status === 'paused') {
        els.resumeAlert.classList.remove('hidden');
        els.btnStart.textContent = "JOB IN PROGRESS...";
        els.btnStart.disabled = true;
        els.btnStart.style.opacity = '0.5';
    }

    // --- 2. TAB SYSTEM ---
    els.tabs.forEach(btn => btn.addEventListener('click', () => {
        // Switch Active Class
        els.tabs.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Switch Content
        els.contents.forEach(c => c.classList.add('hidden'));
        document.getElementById(btn.dataset.tab).classList.remove('hidden');

        // If Library Tab, Render it
        if (btn.dataset.tab === 'tab-library') renderLibrary();
    }));

    // --- 3. LIBRARY LOGIC ---
    function renderLibrary() {
        els.libraryList.innerHTML = '';
        if (library.length === 0) {
            els.emptyLib.style.display = 'block';
            return;
        }
        els.emptyLib.style.display = 'none';

        // Sort by Newest First
        library.sort((a, b) => b.id - a.id).forEach(proj => {
            const div = document.createElement('div');
            div.className = 'lib-item';

            const thumb = proj.coverImage || (proj.pages[0] ? proj.pages[0].image : '');
            // Fallback placeholder if no image
            const imgHtml = thumb ? `<img src="${thumb}" class="lib-thumb">` : `<div class="lib-thumb" style="background:#e2e8f0;"></div>`;

            div.innerHTML = `
                ${imgHtml}
                <div class="lib-info">
                    <div class="lib-title">${proj.title}</div>
                    <div class="lib-date">${new Date(parseInt(proj.id)).toLocaleDateString()} • ${proj.pages.length} Pages</div>
                </div>
            `;
            div.onclick = () => openProject(proj);
            els.libraryList.appendChild(div);
        });
    }

    function openProject(proj) {
        els.libGridView.classList.add('hidden');
        els.projectView.classList.remove('hidden');
        els.projTitle.innerText = proj.title;
        els.projPages.innerHTML = '';

        // Wire Export Button
        // Remove old listeners by cloning
        const newBtn = els.btnExportPdf.cloneNode(true);
        els.btnExportPdf.parentNode.replaceChild(newBtn, els.btnExportPdf);
        // Re-assign to global var
        els.btnExportPdf = newBtn;
        els.btnExportPdf.addEventListener('click', () => exportProjectToPDF(proj));

        // Helper to render row
        const renderRow = (label, img, text, index) => {
            const row = document.createElement('div');
            row.className = 'page-row';
            const imgHtml = img ? `<img src="${img}" class="page-thumb">` : `<div class="page-thumb"></div>`;

            row.innerHTML = `
                ${imgHtml}
                <div class="page-meta">
                    <div style="font-weight:700; font-size:11px; margin-bottom:4px;">${label}</div>
                    <div class="page-text">${text || 'No text content.'}</div>
                    <div class="action-row">
                        <a href="${img || '#'}" download="${proj.title}_${label.replace(' ', '')}.png" class="btn-mini btn-dl" ${!img ? 'style="pointer-events:none; opacity:0.5;"' : ''}>Download</a>
                        <button class="btn-mini btn-fix">⚡ Regenerate</button>
                    </div>
                </div>
            `;
            // Attach Regenerate Listener
            row.querySelector('.btn-fix').onclick = () => startRegeneration(proj, index);
            els.projPages.appendChild(row);
        };

        // Render Cover
        if (proj.coverImage || proj.settings.genCover) {
            renderRow('Cover', proj.coverImage, 'Book Cover Design', -1);
        }

        // Render Pages
        proj.pages.forEach((pg, i) => {
            renderRow(`Page ${pg.page}`, pg.image, pg.text, i);
        });
    }

    els.btnBackLib.addEventListener('click', () => {
        els.projectView.classList.add('hidden');
        els.libGridView.classList.remove('hidden');
    });

    // --- 4. REGENERATION DISPATCHER (With Custom Prompt) ---
    async function startRegeneration(proj, index) {
        // Calculate Default Prompt
        let defaultPrompt = "";
        let contextLabel = "";

        if (index === -1) { // Cover
            defaultPrompt = `Design a PROFESSIONAL BOOK COVER for "${proj.title}". Style: ${proj.settings.artStyle}, High Contrast, Vibrant.`;
            contextLabel = "Cover";
        } else { // Page
            const pg = proj.pages[index];
            const baseP = pg.image_prompt || pg.prompt || `Scene Illustration for page ${pg.page}`;
            defaultPrompt = `Redraw Scene ${pg.page}: ${baseP}. Style: ${proj.settings.artStyle}. Context: ${pg.text}. Maintain consistent character design.`;
            contextLabel = `Page ${pg.page}`;
        }

        // ASK USER FOR CUSTOM INPUT
        const userPrompt = prompt(`Regenerate ${contextLabel}? \nEdit the prompt below to guide the AI:`, defaultPrompt);

        if (!userPrompt) return; // Cancelled by user

        const task = {
            type: 'repair',
            projectId: proj.id,
            pageIndex: index, // -1 for cover
            prompt: userPrompt, // Use user's custom instruction
            bookType: proj.settings.bookType
        };

        await chrome.storage.local.set({ repairTask: task });
        chrome.tabs.create({ url: 'https://gemini.google.com/app' });
    }

    // --- 4B. PDF EXPORT LOGIC ---
    async function exportProjectToPDF(proj) {
        if (!window.jspdf || !window.jspdf.jsPDF) {
            alert("jsPDF library not loaded properly! Check 'libs/jspdf.umd.min.js'");
            return;
        }
        const { jsPDF } = window.jspdf;

        // Parse size: 8.5x11 -> [8.5, 11]
        let format = [8.5, 11];
        if (proj.settings.bookSize) {
            const parts = proj.settings.bookSize.split('x').map(Number);
            if (parts.length === 2) format = parts;
        }

        try {
            const doc = new jsPDF({
                orientation: 'portrait',
                unit: 'in',
                format: format
            });

            const width = doc.internal.pageSize.getWidth();
            const height = doc.internal.pageSize.getHeight();

            // 1. Cover
            if (proj.coverImage) {
                doc.addImage(proj.coverImage, 'JPEG', 0, 0, width, height);
            } else {
                doc.setFontSize(24);
                doc.text(proj.title, width / 2, height / 3, { align: 'center' });
            }

            // 2. Pages
            proj.pages.forEach((pg, i) => {
                if (i > 0 || proj.coverImage) doc.addPage();

                if (pg.image) {
                    // Full Page Image Layout
                    doc.addImage(pg.image, 'JPEG', 0, 0, width, height);
                }
            });

            doc.save(`${proj.title.replace(/[^a-z0-9]/gi, '_')}_KDP.pdf`);
        } catch (e) {
            console.error(e);
            alert("Error creating PDF: " + e.message);
        }
    }

    // --- 5. AUTOMATION HANDLERS ---

    // A. Scrape
    els.btnScrape.addEventListener('click', async () => {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab || !tab.url.includes('amazon')) {
                alert("Please be on an Amazon Product Page.");
                return;
            }

            els.btnScrape.textContent = "⏳";

            // Inject
            await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['amazon_scraper.js'] });

            // Send Message
            chrome.tabs.sendMessage(tab.id, { action: 'scrape_amazon' }, (res) => {
                els.btnScrape.textContent = "🔍";

                if (chrome.runtime.lastError) {
                    console.error("Scrape Error:", chrome.runtime.lastError);
                    alert("Communication error. Please refresh the Amazon page and try again.");
                    return;
                }

                if (res && res.data) {
                    const d = res.data;
                    els.title.value = d.title;
                    els.plot.value = d.description;
                    // Save negatives silently
                    chrome.storage.local.set({ negativeKeywords: d.negativeKeywords });
                    // Flash success
                    els.btnScrape.style.background = '#dcfce7';
                    setTimeout(() => els.btnScrape.style.background = '', 1000);
                } else {
                    alert("Scrape failed. Please check console.");
                }
            });
        } catch (e) {
            console.error("Injection Error:", e);
            els.btnScrape.textContent = "❌";
            alert("Script injection failed: " + e.message);
        }
    });

    // B. Start Job
    els.btnStart.addEventListener('click', async () => {
        if (!els.title.value) { alert("Please enter a Title."); return; }

        // Check active job
        const currentStorage = await chrome.storage.local.get('activeJob');
        if (currentStorage.activeJob && currentStorage.activeJob.status === 'running') {
             if(!confirm("A job is currently running! Starting a new one will overwrite it. Continue?")) return;
        }

        const settings = {
            pageCount: parseInt(els.pages.value),
            artStyle: els.style.value,
            bookSize: els.size.value,
            genCover: els.cover.checked,
            bookType: els.style.value.includes('Line Art') ? 'coloring' : 'story'
        };

        const job = {
            id: Date.now(),
            title: els.title.value,
            author: els.author.value || "Anonymous",
            description: els.plot.value,
            settings: settings,
            status: 'running',
            completedPages: 0,
            images: [],
            storyTexts: [],
            sceneData: null,
            negativeKeywords: (await chrome.storage.local.get('negativeKeywords')).negativeKeywords || "text, watermark, blurry"
        };

        await chrome.storage.local.set({ activeJob: job });
        chrome.tabs.create({ url: 'https://gemini.google.com/app' });
        window.close();
    });

    // C. Resume / Discard
    els.btnResume.addEventListener('click', () => {
        // Just launch Gemini, the bot will pick up the activeJob
        chrome.tabs.create({ url: 'https://gemini.google.com/app' });
        window.close();
    });

    els.btnDiscard.addEventListener('click', async () => {
        await chrome.storage.local.remove('activeJob');
        els.resumeAlert.classList.add('hidden');
        els.btnStart.disabled = false;
        els.btnStart.textContent = "START AUTOMATION";
        els.btnStart.style.opacity = '1';
    });

    // D. Stop (Broadcast)
    els.btnStop.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'STOP_JOB' });
    });

});
