const { Worker } = require("bullmq");
const { scrapeGoogleMaps } = require("./index");
const Redis = { host: "127.0.0.1", port: 6379 };

console.log("Starting Scraper Worker...");

const worker = new Worker("scrape-queue", async job => {
    console.log(`Job ${job.id} started. Query: "${job.data.query}", Limit: ${job.data.limit}`);

    const { query, limit } = job.data;

    // Report 5% progress
    await job.updateProgress(5);

    const results = await scrapeGoogleMaps(query, limit);

    // Report 90% progress
    await job.updateProgress(90);

    console.log(`Job ${job.id} finished. Found ${results.length} results.`);

    return {
        success: true,
        count: results.length,
        results
    };
}, {
    connection: Redis,
    concurrency: 1 // Keep to 1 to prevent Puppeteer overload
});

// Webhook Helper
const sendWebhook = async (url, payload) => {
    try {
        await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        console.log("Webhook delivered");
    } catch (err) {
        console.log("Webhook failed", err.message);
    }
};

worker.on("completed", async job => {
    console.log("Job completed", job.id);

    if (job.data.webhookUrl) {
        await sendWebhook(job.data.webhookUrl, {
            jobId: job.id,
            status: "completed",
            success: true,
            count: job.returnvalue.count,
            results: job.returnvalue.results
        });
    }
});

worker.on("failed", async (job, err) => {
    console.log("Job failed", job?.id, err?.message);

    if (job?.data?.webhookUrl) {
        await sendWebhook(job.data.webhookUrl, {
            jobId: job.id,
            status: "failed",
            success: false,
            error: err?.message || "Unknown error"
        });
    }
});
