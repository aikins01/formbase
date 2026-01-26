import { Queue } from 'bullmq';

import { getRedisConnection } from '../connection';

export interface WebhookJobData {
  formId: string;
  formDataId: string;
  webhookUrl: string;
  payload: {
    event: 'submission.created';
    payload: {
      id: string;
      formId: string;
      formTitle: string;
      data: Record<string, unknown>;
      fileUrls: string[];
      isSpam: boolean;
      spamReason: string | null;
      createdAt: string;
    };
  };
  deliveryLogId: string;
}

let webhookQueue: Queue<WebhookJobData> | null = null;

export function getWebhookQueue(): Queue<WebhookJobData> {
  if (!webhookQueue) {
    webhookQueue = new Queue<WebhookJobData>('webhook', {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'custom' },
        removeOnComplete: true,
        removeOnFail: false,
      },
    });
  }
  return webhookQueue;
}
