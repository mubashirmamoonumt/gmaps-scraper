const puppeteer = require('puppeteer');
const fs = require('fs');

/**
 * Scrapes Google Maps for a given query.
 * @param {string} query - The search query.
 * @param {number} limit - Max results to scrape.
 * @returns {Promise<Array>}
 */
async function scrapeGoogleMaps(query, limit = 10) {
    // HEADLESS MODE: Change this to true for production/VPS
    const isHeadless = process.argv.includes('--headless');

    const browser = await puppeteer.launch({
        headless: isHeadless ? "new" : false,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800']
    });
    const page = await browser.newPage();

    // Enable console logging from browser to node
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));

    await page.setViewport({ width: 1280, height: 800 });

    // Set User Agent to Desktop to prevent mobile/simplified layout in headless
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    try {
        await page.goto('https://www.google.com/maps', { waitUntil: 'networkidle2' });

        await page.waitForSelector('#searchboxinput');
        await page.type('#searchboxinput', query);
        await page.keyboard.press('Enter');

        const feedSelector = 'div[role="feed"]';
        await page.waitForFunction(() => {
            return document.querySelector('div[role="feed"]') || document.querySelector('div[aria-label^="Results for"]');
        }, { timeout: 15000 });

        console.log(`Searching for "${query}" (Limit: ${limit})...`);
        const delay = (ms) => new Promise(r => setTimeout(r, ms));

        let processed = new Set();
        let results = [];
        let endOfList = false;

        // --- SCROLLING PHASE ---
        while (results.length < limit && !endOfList) {
            const items = await page.$$('div[role="feed"] > div > div[jsaction]');

            if (items.length === 0) {
                await delay(2000);
                continue;
            }

            console.log(`Found ${items.length} loaded items so far...`);

            const previousHeight = await page.evaluate((sel) => {
                const el = document.querySelector(sel);
                return el ? el.scrollHeight : 0;
            }, feedSelector);

            await page.evaluate((sel) => {
                const el = document.querySelector(sel);
                if (el) el.scrollTo(0, el.scrollHeight);
            }, feedSelector);

            await delay(2000);

            const newHeight = await page.evaluate((sel) => {
                const el = document.querySelector(sel);
                return el ? el.scrollHeight : 0;
            }, feedSelector);

            if (newHeight === previousHeight) {
                await delay(2000);
                const checkHeight = await page.evaluate((sel) => document.querySelector(sel).scrollHeight, feedSelector);
                if (checkHeight === previousHeight) endOfList = true;
            }

            const currentCount = await page.evaluate((sel) => document.querySelectorAll(sel + ' > div > div[jsaction]').length, feedSelector);
            if (currentCount >= limit) break;
        }

        // --- EXTRACTION PHASE ---
        console.log('Starting extraction phase...');

        // Strategy: Find all anchor tags that link to a /place/ URL. 
        // These are guaranteed to be the business entries.
        // We limit by the 'limit' parameter.
        const places = await page.$$('a[href^="https://www.google.com/maps/place"]');
        console.log(`Found ${places.length} potential business links.`);

        const processCount = Math.min(places.length, limit);

        for (let i = 0; i < processCount; i++) {
            // Re-query to avoid stale nodes
            const currentPlaces = await page.$$('a[href^="https://www.google.com/maps/place"]');
            const item = currentPlaces[i];

            if (!item) break;

            if (!item) break;

            // Get Name from the link itself (most reliable)
            // Try aria-label, then title, then innerText
            let nameFromLink = await item.evaluate(el => el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText);
            console.log(`Processing item ${i}: Found Name="${nameFromLink}"`);

            // Store current URL to verify navigation later
            const previousUrl = page.url();

            // Scroll into view
            try {
                await item.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'center' }));
                await item.click();
            } catch (e) {
                console.log(`Error clicking item ${i}: ${e.message}`);
                continue;
            }

            // SMART WAIT Strategy:
            // 1. Wait for URL to change (Base requirement)
            try {
                await page.waitForFunction(
                    (prev) => window.location.href !== prev && window.location.href.includes('/place/'),
                    { timeout: 10000 },
                    previousUrl
                );
            } catch (e) {
                // If it times out, it might mean we clicked the same business again or it didn't load.
                // We'll try to extract anyway, but this usually explains the "skipping" (stale data).
                console.log(`Warning: Navigation timeout for item ${i}. URL might not have changed.`);
            }

            // 2. STRICT CONTENT WAIT (The missing piece):
            // Wait until the H1 in the panel matches the name we clicked.
            // This prevents extracting stale data from the previous business.
            try {
                await page.waitForFunction(
                    (expectedName) => {
                        const h1 = document.querySelector('h1.DUwDvf') || document.querySelector('div[role="main"] h1');
                        return h1 && h1.innerText.trim() === expectedName;
                    },
                    { timeout: 5000 }, // Wait up to 5s for text to update
                    nameFromLink
                );
            } catch (e) {
                console.log(`Warning: Content didn't update to match "${nameFromLink}" (Stale data risk)`);
            }

            // Small buffer for content processing (reviews etc)
            await delay(1500);

            // Extract Details
            const data = await page.evaluate(async (nameFromLink) => {
                // Strategy: Robust Container Selection.
                // We must find the specific 'div[role="main"]' that belongs to THIS business.
                // We do this by finding the one containing an H1 that matches our clicked name.

                let mainContainer = null;
                const mains = Array.from(document.querySelectorAll('div[role="main"]'));
                const normalize = (s) => (s || '').toLowerCase().trim().replace(/\s+/g, ' ');
                const targetName = normalize(nameFromLink);

                // 1. Strict/Normalized Match
                mainContainer = mains.find(m => {
                    const h1 = m.querySelector('h1');
                    return h1 && normalize(h1.innerText) === targetName;
                });

                // 2. Partial Match (Fallback if minor text differences)
                if (!mainContainer) {
                    mainContainer = mains.find(m => {
                        const h1 = m.querySelector('h1');
                        if (!h1) return false;
                        const h1Text = normalize(h1.innerText);
                        return h1Text.includes(targetName) || targetName.includes(h1Text);
                    });
                }

                // 3. Last Resort: Directions Button Container
                if (!mainContainer) {
                    const directions = Array.from(document.querySelectorAll('button[data-value="Directions"], button[aria-label*="Directions"]'));
                    const lastDir = directions.pop(); // Use the last/newest one
                    if (lastDir) mainContainer = lastDir.closest('div[role="main"]');
                }

                if (!mainContainer) return null; // Can't find the right panel

                const getText = (val) => val ? val.innerText.trim() : '';
                const getAttr = (el, attr) => el ? el.getAttribute(attr) : '';
                const queryMain = (sel) => mainContainer.querySelector(sel);
                const queryAllMain = (sel) => Array.from(mainContainer.querySelectorAll(sel));

                // Name: Use the link's aria-label first (most reliable), then fallback to DOM
                let name = nameFromLink;

                if (!name) {
                    name = getText(queryMain('h1'));
                }

                if (name === 'Results' || !name) {
                    return null; // Invalid item
                }

                // Wait for reviews to likely appear (Address/Reviews often load async)
                try {
                    await new Promise(resolve => {
                        let attempts = 0;
                        const interval = setInterval(() => {
                            attempts++;
                            // Check for review text
                            const text = mainContainer.innerText || '';
                            // Or check if the specific review element exists (more robust)
                            // But checking text covers both "100 reviews" and ARIA labels if included in innerText (unlikely for aria)
                            // Let's just check if text content grows or has 'reviews'
                            if (text.includes('reviews') || text.includes('review') || attempts >= 20) { // 2 seconds max
                                clearInterval(interval);
                                resolve();
                            }
                        }, 100);
                    });
                } catch (e) { /* ignore */ }

                // Rating & Reviews
                // Strategy: Use the ARIA label of the stars element inside MAIN container.
                const starsEl = queryMain('span[role="img"][aria-label*="stars"]');
                const ariaLabel = starsEl ? starsEl.getAttribute('aria-label') : '';

                const ratingContainer = queryMain('div.F7nice');
                const ratingText = ratingContainer ? ratingContainer.innerText : '';

                // Rating
                let rating = '0';
                const ratingMatch = (ariaLabel || ratingText).match(/([\d.]+)\s*stars?/);
                if (ratingMatch) {
                    rating = ratingMatch[1];
                } else {
                    // Fallback simple float match
                    const simpleRating = (ariaLabel || ratingText).match(/^([\d.]+)/);
                    if (simpleRating) rating = simpleRating[1];
                }

                // Reviews
                let reviews = '0';

                // Helper to extract reviews from text
                const parseReviews = (text) => {
                    if (!text) return null;
                    // Try "1,234 reviews" or "1.2k reviews"
                    const match = text.match(/([\d,.]+[kK]?)\s*reviews?/i);
                    if (match) return match[1];
                    // Try "(1,234)" or "(1.2k)"
                    const parenMatch = text.match(/\(([\d,.]+[kK]?)\)/);
                    if (parenMatch) return parenMatch[1];
                    return null;
                };

                // 1. Try ARIA label of stars (most reliable)
                let r = parseReviews(ariaLabel);
                if (r) reviews = r;

                // 2. Try Rating Container text
                if (reviews === '0' || !reviews) {
                    r = parseReviews(ratingText);
                    if (r) reviews = r;
                }

                // 3. NUCLEAR OPTION: Search entire mainContainer text
                if (reviews === '0' || !reviews) {
                    const mainText = mainContainer.innerText || '';
                    r = parseReviews(mainText);
                    if (r) reviews = r;

                    // 4. Try looking for buttons with review count (common in mobile/headless)
                    if (!r) {
                        const buttons = queryAllMain('button');
                        for (const btn of buttons) {
                            const label = btn.getAttribute('aria-label') || btn.innerText;
                            r = parseReviews(label);
                            if (r) {
                                reviews = r;
                                break;
                            }
                        }
                    }


                }




                // Cleanup commas
                reviews = reviews.replace(/,/g, '');

                // Address
                let address = getAttr(queryMain('button[data-item-id="address"]'), 'aria-label');
                if (!address) {
                    const buttons = queryAllMain('button');
                    const addrBtn = buttons.find(b => b.getAttribute('aria-label')?.includes('Address:'));
                    if (addrBtn) address = addrBtn.getAttribute('aria-label');
                }

                // Phone
                let phone = getAttr(queryMain('button[data-item-id^="phone"]'), 'aria-label');
                if (!phone) {
                    const buttons = queryAllMain('button');
                    const phoneBtn = buttons.find(b => b.getAttribute('aria-label')?.includes('Phone:'));
                    if (phoneBtn) phone = phoneBtn.getAttribute('aria-label');
                }

                // Website
                let website = getAttr(queryMain('a[data-item-id="authority"]'), 'href');
                if (!website) {
                    const anchors = queryAllMain('a');
                    const webAnchor = anchors.find(a => a.getAttribute('aria-label')?.includes('Website:'));
                    if (webAnchor) website = webAnchor.href;
                }

                // Claimed Status
                const bodyText = mainContainer.innerText; // Scope to main container
                const isClaimed = !bodyText.includes("Claim this business");
                const businessClaimed = isClaimed ? "Yes" : "NO";

                return { name, rating, reviews, address, phone, website, businessClaimed };
            }, nameFromLink);

            // Post-Browser Extraction (URL)
            if (!data) {
                console.log("Skipping invalid entry (Header/Results or empty name)");
                continue;
            }

            if (data.debug_text) {
                console.log(`Debug: Failed to extract reviews. Dumped text to debug_dump.txt`);
                try { require('fs').writeFileSync('debug_dump.txt', data.debug_text); } catch (e) { console.error('Write failed', e); }
                continue; // stop processing this item since it failed validation
            }

            const currentUrl = page.url();
            data.googleMapsLink = currentUrl;

            // Cleanup fields
            if (data.address) data.address = data.address.replace('Address: ', '').trim();
            if (data.phone) data.phone = data.phone.replace('Phone: ', '').trim();

            // Deduplication Check
            // Now that we have exact URL, using URL as key is safer than Name+Address
            const key = data.googleMapsLink;

            // Also keep Name+Address as fallback if URL is generic (unlikely if /place/ worked)
            const fallbackKey = `${data.name}|${data.address}`;

            if ((!processed.has(key) && !processed.has(fallbackKey)) && data.name) {
                processed.add(key);
                processed.add(fallbackKey);
                results.push(data);
                console.log(`Extracted: ${data.name}`);
            } else {
                console.log(`Skipping duplicate (already processed): ${data.name}`);
            }
        }

        console.log(`Extracted total ${results.length} unique items.`);
        return results;

    } catch (error) {
        console.error('Error during scraping:', error);
        return [];
    } finally {
        await browser.close();
    }
}

function saveToCsv(data, filename) {
    if (!data.length) return;
    const headers = Object.keys(data[0]).join(',');
    const rows = data.map(obj => Object.values(obj).map(val => {
        const str = String(val || '').replace(/"/g, '""'); // Escape quotes
        return `"${str}"`;
    }).join(','));
    const csvContent = [headers, ...rows].join('\n');
    fs.writeFileSync(filename, csvContent);
    console.log(`Saved data to ${filename}`);
}

// CLI Execution
if (require.main === module) {
    const query = process.argv[2] || 'Restaurants in New York';
    const limit = process.argv[3] || 10;
    scrapeGoogleMaps(query, parseInt(limit)).then(data => {
        // Use timestamp to avoid EBUSY (file locked) errors
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        saveToCsv(data, `output_${timestamp}.csv`);
    });
}

module.exports = { scrapeGoogleMaps };
