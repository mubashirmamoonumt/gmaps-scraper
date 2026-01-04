const express = require('express');
const { Queue } = require("bullmq");
const { scrapeGoogleMaps } = require('./index');

const app = express();
const PORT = process.env.PORT || 3030;

// Single backend key. Later you can route users through n8n credits system.
const API_KEY = process.env.API_KEY || "my-secret-key";

// Redis Connection for Queue
const Redis = { host: "127.0.0.1", port: 6379 };
const scrapeQueue = new Queue("scrape-queue", { connection: Redis });

// Middleware: API Key Check
app.use((req, res, next) => {
    // Allow root to pass without key for health check
    if (req.path === '/') return next();

    const clientKey = req.headers['x-api-key'];
    if (!clientKey || clientKey !== API_KEY) {
        return res.status(401).json({
            success: false,
            message: 'Invalid or missing API key'
        });
    }
    next();
});

app.get('/', (req, res) => {
    res.send('Google Maps Scraper API (Queue Enabled) is running! Use /scrape or /queue-scrape');
});

// A. Synchronous Scrape (Original)
// Good for small tests or non-production usage
app.get('/scrape', async (req, res) => {
    const query = req.query.q;
    const limit = req.query.limit || 5;

    if (!query) {
        return res.status(400).json({
            success: false,
            message: 'Missing parameter q'
        });
    }

    console.log(`SYNC REQUEST OK, query="${query}", limit=${limit}`);

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

// B. Queued Scrape (Production)
// Returns Job ID immediately
app.get("/queue-scrape", async (req, res) => {
    const query = req.query.q;
    const limit = parseInt(req.query.limit || 10);

    if (!query) {
        return res.status(400).json({ error: "Missing q param" });
    }

    // Add job to queue
    const job = await scrapeQueue.add("scrape", { query, limit });

    res.json({
        queued: true,
        jobId: job.id,
        statusUrl: `/job-status?id=${job.id}`
    });
});

// C. Job Status
app.get("/job-status", async (req, res) => {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: "Missing id" });

    const job = await scrapeQueue.getJob(id);
    if (!job) return res.status(404).json({ error: "Job not found" });

    const state = await job.getState();
    const progress = job.progress;

    res.json({
        id,
        state,
        progress,
        result: job.returnvalue || null
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Queue ready.`);
    console.log(`Test Sync:  curl -H "x-api-key: ${API_KEY}" "http://localhost:${PORT}/scrape?q=Pizza&limit=3"`);
    console.log(`Test Queue: curl -H "x-api-key: ${API_KEY}" "http://localhost:${PORT}/queue-scrape?q=Pizza&limit=100"`);
});
