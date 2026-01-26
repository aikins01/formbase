import { closeRedisConnection, createWebhookWorker } from '@formbase/queue';

console.log('Starting webhook worker...');

const worker = createWebhookWorker();

worker.on('completed', (job) => {
  console.log(`Job ${job.id} completed successfully`);
});

worker.on('failed', (job, err) => {
  console.error(`Job ${job?.id} failed:`, err.message);
});

worker.on('error', (err) => {
  console.error('Worker error:', err);
});

async function shutdown() {
  console.log('Shutting down worker...');
  await worker.close();
  await closeRedisConnection();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

console.log('Webhook worker is running. Press Ctrl+C to stop.');
