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

worker.on("completed", job => {
    console.log("Job completed", job.id);
});

worker.on("failed", (job, err) => {
    console.log("Job failed", job?.id, err?.message);
});
