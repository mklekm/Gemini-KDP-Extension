// amazon_scraper.js - V12 Nuclear Edition (HD Cover Extraction)
(() => {
    // Prevent double injection
    if (window.geminiScraper) return;
    window.geminiScraper = true;

    console.log("Gemini KDP: Scraper Loaded (Nuclear Mode)");

    chrome.runtime.onMessage.addListener((m, s, send) => {
        if (m.action === 'scrape_amazon') {
            try {
                const data = scrape();
                send({ success: true, data: data });
            } catch (e) {
                console.error("Scrape Failed:", e);
                send({ success: false, error: e.message });
            }
        }
    });

    function scrape() {
        // 1. Metadata Extraction
        const title = document.getElementById('productTitle')?.innerText.trim() ||
                      document.getElementById('ebooksProductTitle')?.innerText.trim() ||
                      document.getElementById('title')?.innerText.trim() ||
                      document.querySelector('h1')?.innerText.trim() ||
                      document.title;

        let desc = "";
        const descSelectors = [
            '#bookDescription_feature_div .a-expander-content',
            'div[data-feature-name="bookDescription"]',
            '#editorialReviews_feature_div',
            'meta[name="description"]',
            '.a-expander-content' // Generic fallback
        ];

        for (const sel of descSelectors) {
            const el = document.querySelector(sel);
            if (el) {
                const txt = el.innerText.trim();
                // Ensure it's substantial content
                if (txt.length > 20 && !txt.includes("Read more")) {
                    desc = txt;
                    break;
                }
                // If it's a meta tag
                if (el.tagName === 'META' && el.content && el.content.length > 20) {
                    desc = el.content;
                    break;
                }
            }
        }

        // 2. NUCLEAR OPTION: HD Cover Extraction
        let coverUrl = "";

        // Strategy A: Main Image Element Candidates
        const imgEl = document.querySelector('#imgBlkFront') ||
            document.querySelector('#ebooksImgBlkFront') ||
            document.querySelector('#main-image') ||
            document.querySelector('#landingImage') ||
            document.querySelector('.frontImage'); // Generic

        if (imgEl) {
            console.log("Found Main Image Element:", imgEl.id || imgEl.className);

            // Priority 1: JSON Dynamic Data (Best Quality)
            try {
                const dynamicData = imgEl.getAttribute('data-a-dynamic-image');
                if (dynamicData) {
                    const parsed = JSON.parse(dynamicData);
                    // Sort by resolution (Width * Height) Descending
                    const sortedUrls = Object.entries(parsed).sort((a, b) => (b[1][0] * b[1][1]) - (a[1][0] * a[1][1]));
                    if (sortedUrls.length) {
                        coverUrl = sortedUrls[0][0];
                        console.log("Strategy 1 (JSON) Success:", coverUrl);
                    }
                }
            } catch (e) { console.warn("JSON Cover parse failed", e); }

            // Priority 2: Old Hires Attribute
            if (!coverUrl) {
                coverUrl = imgEl.getAttribute('data-old-hires');
                if (coverUrl) console.log("Strategy 2 (Old Hires) Success:", coverUrl);
            }

            // Priority 3: Src Cleaning (Regex)
            if (!coverUrl && imgEl.src) {
                // Remove Amazon's resizing params (e.g., ._AC_SY400_.jpg -> .jpg)
                if (imgEl.src.includes('._AC')) {
                    coverUrl = imgEl.src.replace(/\._AC_[a-zA-Z0-9_,]+_\./, '.');
                    console.log("Strategy 3 (Regex) Success:", coverUrl);
                } else {
                    coverUrl = imgEl.src;
                }
            }
        }

        // Strategy B: DOM Scan Fallback (If main element failed or missing)
        if (!coverUrl) {
            console.log("Main element failed. scanning DOM...");
            const allImgs = Array.from(document.querySelectorAll('img'));
            // Find largest vertical image (likely the cover)
            const candidates = allImgs.filter(i => {
                return i.naturalHeight > 500 &&
                    i.naturalHeight > i.naturalWidth &&
                    (i.src.includes('images-na.ssl-images-amazon.com') || i.src.includes('m.media-amazon.com'));
            });

            if (candidates.length) {
                candidates.sort((a, b) => (b.naturalWidth * b.naturalHeight) - (a.naturalWidth * a.naturalHeight));
                coverUrl = candidates[0].src;
                // Try to clean it too
                if (coverUrl.includes('._AC')) {
                    coverUrl = coverUrl.replace(/\._AC_[a-zA-Z0-9_,]+_\./, '.');
                }
                console.log("Strategy 4 (DOM Scan) Success:", coverUrl);
            }
        }

        // 3. Review Analysis (Negative Keywords)
        const negKeywords = "blurry, low quality, pixelated, distorted, bad anatomy, text, watermark, logo, grainy, low resolution";

        return {
            title,
            description: desc.substring(0, 5000),
            coverUrl,
            negativeKeywords: negKeywords
        };
    }
})();
