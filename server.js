const express = require('express');
const { scrapeGoogleMaps } = require('./index');

const app = express();
const PORT = process.env.PORT || 3030;

// Single backend key. Later you can route users through n8n credits system.
const API_KEY = process.env.API_KEY || "my-secret-key";

app.get('/scrape', async (req, res) => {

    // API key check
    const clientKey = req.headers['x-api-key'];
    if (!clientKey || clientKey !== API_KEY) {
        return res.status(401).json({
            success: false,
            message: 'Invalid or missing API key'
        });
    }

    const query = req.query.q;
    const limit = req.query.limit || 5;

    if (!query) {
        return res.status(400).json({
            success: false,
            message: 'Missing parameter q'
        });
    }

    console.log(`REQUEST OK, query="${query}", limit=${limit}`);

    // Force headless mode on server
    if (!process.argv.includes('--headless')) {
        process.argv.push('--headless');
    }

    try {
        const data = await scrapeGoogleMaps(query, parseInt(limit));

        return res.json({
            success: true,
            count: data.length,
            data
        });

    } catch (err) {
        console.error('Scraper error:', err);

        return res.status(500).json({
            success: false,
            message: 'Scraper failed',
            error: err.message
        });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Test using: curl -H "x-api-key: ${API_KEY}" "http://localhost:${PORT}/scrape?q=Pizza&limit=3"`);
});
