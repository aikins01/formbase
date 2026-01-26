import type { Job } from 'bullmq';
import type { WebhookJobData } from '../queues/webhook';

import { Worker } from 'bullmq';
import { eq } from 'drizzle-orm';

import { db } from '@formbase/db';
import { webhookDeliveryLogs } from '@formbase/db/schema';

import { getRedisConnection } from '../connection';
import { deliverWebhook } from '../services/delivery';

const RETRY_DELAYS_MS = [60_000, 600_000, 3_600_000, 21_600_000, 86_400_000];

function getRetryDelay(attemptsMade: number): number {
  const index = Math.min(attemptsMade - 1, RETRY_DELAYS_MS.length - 1);
  return RETRY_DELAYS_MS[index] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]!;
}

async function processWebhook(job: Job<WebhookJobData>): Promise<void> {
  const { deliveryLogId } = job.data;
  const attemptNumber = job.attemptsMade + 1;

  await db
    .update(webhookDeliveryLogs)
    .set({ attempts: attemptNumber })
    .where(eq(webhookDeliveryLogs.id, deliveryLogId));

  const result = await deliverWebhook(job.data);

  if (result.success) {
    await db
      .update(webhookDeliveryLogs)
      .set({
        status: 'success',
        statusCode: result.statusCode ?? null,
        responseBody: result.body?.slice(0, 10_000) ?? null,
        completedAt: new Date(),
        nextRetryAt: null,
      })
      .where(eq(webhookDeliveryLogs.id, deliveryLogId));
    return;
  }

  const isLastAttempt = attemptNumber >= 5;
  const nextRetryAt = isLastAttempt
    ? null
    : new Date(Date.now() + getRetryDelay(attemptNumber));

  await db
    .update(webhookDeliveryLogs)
    .set({
      status: isLastAttempt ? 'failed' : 'pending',
      statusCode: result.statusCode ?? null,
      responseBody: result.body?.slice(0, 10_000) ?? null,
      errorMessage: result.error ?? null,
      completedAt: isLastAttempt ? new Date() : null,
      nextRetryAt,
    })
    .where(eq(webhookDeliveryLogs.id, deliveryLogId));

  if (!isLastAttempt) {
    throw new Error(result.error ?? `HTTP ${result.statusCode}`);
  }
}

export function createWebhookWorker(): Worker<WebhookJobData> {
  return new Worker<WebhookJobData>('webhook', processWebhook, {
    connection: getRedisConnection(),
    concurrency: 10,
    settings: {
      backoffStrategy: (attemptsMade: number) => getRetryDelay(attemptsMade),
    },
  });
}
