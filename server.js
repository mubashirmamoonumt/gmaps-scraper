const express = require('express');
const { Queue } = require("bullmq");
const { scrapeGoogleMaps } = require('./index');

const app = express();
const PORT = process.env.PORT || 3030;

const API_KEY = process.env.API_KEY || "my-secret-key";

const Redis = { host: "127.0.0.1", port: 6379 };
const scrapeQueue = new Queue("scrape-queue", { connection: Redis });

// API Key Middleware
app.use((req, res, next) => {
    if (req.path === '/') return next();

    const key = req.headers['x-api-key'];
    if (!key || key !== API_KEY) {
        return res.status(401).json({
            success: false,
            message: "Invalid or missing API key"
        });
    }

    next();
});

// Health Route
app.get('/', (req, res) => {
    res.send("Google Maps Scraper API (Queue Enabled) is running.");
});

// Direct scrape (sync)
app.get('/scrape', async (req, res) => {

    const query = req.query.q;
    const limit = parseInt(req.query.limit || 5);

    if (!query) {
        return res.status(400).json({ error: "Missing q param" });
    }

    console.log(`SYNC SCRAPE -> "${query}" limit=${limit}`);

    try {
        const data = await scrapeGoogleMaps(query, limit);

        return res.json({
            success: true,
            count: data.length,
            data
        });

    } catch (err) {
        console.error("Scrape failed:", err);
        return res.status(500).json({
            success: false,
            message: "Scraper failed",
            error: err.message
        });
    }
});

// Queue scrape (async)
app.get('/queue-scrape', async (req, res) => {

    const query = req.query.q;
    const limit = parseInt(req.query.limit || 10);
    const webhookUrl = req.query.webhook_url || null;

    if (!query) {
        return res.status(400).json({ error: "Missing q param" });
    }

    const job = await scrapeQueue.add("scrape", {
        query,
        limit,
        webhookUrl
    });

    res.json({
        queued: true,
        jobId: job.id,
        webhookAttached: Boolean(webhookUrl),
        statusUrl: `/job-status?id=${job.id}`
    });
});

// Job status
app.get('/job-status', async (req, res) => {

    const id = req.query.id;
    if (!id) return res.status(400).json({ error: "Missing id" });

    const job = await scrapeQueue.getJob(id);
    if (!job) return res.status(404).json({ error: "Job not found" });

    const state = await job.getState();

    res.json({
        id,
        state,
        progress: job.progress,
        result: job.returnvalue || null
    });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log("Queue ready.");
    console.log(`Test Sync:  curl -H "x-api-key: ${API_KEY}" "http://localhost:${PORT}/scrape?q=Pizza&limit=3"`);
    console.log(`Test Queue: curl -H "x-api-key: ${API_KEY}" "http://localhost:${PORT}/queue-scrape?q=Pizza&limit=10"`);
});
