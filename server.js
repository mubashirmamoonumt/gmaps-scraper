const express = require('express');
const { scrapeGoogleMaps } = require('./index');
const app = express();
// Use port 3030 to avoid conflict with standard ports (like 3000 which n8n or others might use)
const PORT = process.env.PORT || 3030;

app.get('/scrape', async (req, res) => {
    const query = req.query.q;
    const limit = req.query.limit || 5;

    if (!query) {
        return res.status(400).json({ error: 'Missing parameter "q". Usage: /scrape?q=Pizza+in+London&limit=10' });
    }

    console.log(`Received Request: Query="${query}", Limit=${limit}`);

    // Force HEADLESS mode for server environment
    // The scraper checks process.argv for --headless, but since we are calling the function directly,
    // we need to make sure the browser launches in headless mode.
    // NOTE: The current index.js relies on process.argv for the --headless flag.
    // We should probably modify index.js to accept an options object, OR we hack it here by pushing to argv.
    if (!process.argv.includes('--headless')) {
        process.argv.push('--headless');
    }

    try {
        const data = await scrapeGoogleMaps(query, parseInt(limit));
        res.json({
            success: true,
            count: data.length,
            data: data
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Test URL: http://localhost:${PORT}/scrape?q=Pizza&limit=3`);
});
