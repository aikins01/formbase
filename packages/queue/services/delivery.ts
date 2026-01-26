import type { WebhookJobData } from '../queues/webhook';

import { eq } from 'drizzle-orm';

import { db } from '@formbase/db';
import { formDatas, forms, webhookDeliveryLogs } from '@formbase/db/schema';
import { generateId } from '@formbase/utils/generate-id';

import { getWebhookQueue } from '../queues/webhook';

const WEBHOOK_TIMEOUT_MS = 30_000;

export function validateWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') return true;
    if (
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function extractFileUrls(data: Record<string, unknown>): string[] {
  const urls: string[] = [];
  for (const value of Object.values(data)) {
    if (typeof value === 'string' && value.startsWith('http')) {
      urls.push(value);
    }
  }
  return urls;
}

export async function buildWebhookPayload(
  formId: string,
  formDataId: string,
): Promise<WebhookJobData['payload'] | null> {
  const [form, formData] = await Promise.all([
    db.query.forms.findFirst({
      where: eq(forms.id, formId),
      columns: { id: true, title: true },
    }),
    db.query.formDatas.findFirst({
      where: eq(formDatas.id, formDataId),
      columns: {
        id: true,
        data: true,
        isSpam: true,
        spamReason: true,
        createdAt: true,
      },
    }),
  ]);

  if (!form || !formData) return null;

  const parsedData = JSON.parse(formData.data) as Record<string, unknown>;
  const fileUrls = extractFileUrls(parsedData);

  return {
    event: 'submission.created',
    payload: {
      id: formData.id,
      formId: form.id,
      formTitle: form.title,
      data: parsedData,
      fileUrls,
      isSpam: formData.isSpam,
      spamReason: formData.spamReason,
      createdAt: formData.createdAt.toISOString(),
    },
  };
}

export async function enqueueWebhook(
  formId: string,
  formDataId: string,
  webhookUrl: string,
): Promise<string | null> {
  const payload = await buildWebhookPayload(formId, formDataId);
  if (!payload) return null;

  const logId = generateId(15);

  await db.insert(webhookDeliveryLogs).values({
    id: logId,
    formId,
    formDataId,
    webhookUrl,
    payload: JSON.stringify(payload),
    status: 'pending',
    attempts: 0,
  });

  const queue = getWebhookQueue();
  await queue.add(
    'deliver',
    {
      formId,
      formDataId,
      webhookUrl,
      payload,
      deliveryLogId: logId,
    },
    { jobId: logId },
  );

  return logId;
}

export async function deliverWebhook(data: WebhookJobData): Promise<{
  success: boolean;
  statusCode?: number;
  body?: string;
  error?: string;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

  try {
    const response = await fetch(data.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data.payload),
      signal: controller.signal,
    });

    const body = await response.text();

    if (response.ok) {
      return { success: true, statusCode: response.status, body };
    }

    return { success: false, statusCode: response.status, body };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, error: message };
  } finally {
    clearTimeout(timeout);
  }
}

export async function createTestWebhookJob(
  formId: string,
  webhookUrl: string,
): Promise<string | null> {
  const form = await db.query.forms.findFirst({
    where: eq(forms.id, formId),
    columns: { id: true, title: true },
  });

  if (!form) return null;

  const lastSubmission = await db.query.formDatas.findFirst({
    where: eq(formDatas.formId, formId),
    orderBy: (table, { desc }) => desc(table.createdAt),
    columns: {
      id: true,
      data: true,
      isSpam: true,
      spamReason: true,
      createdAt: true,
    },
  });

  let payload: WebhookJobData['payload'];

  if (lastSubmission) {
    const parsedData = JSON.parse(lastSubmission.data) as Record<
      string,
      unknown
    >;
    payload = {
      event: 'submission.created',
      payload: {
        id: lastSubmission.id,
        formId: form.id,
        formTitle: form.title,
        data: parsedData,
        fileUrls: extractFileUrls(parsedData),
        isSpam: lastSubmission.isSpam,
        spamReason: lastSubmission.spamReason,
        createdAt: lastSubmission.createdAt.toISOString(),
      },
    };
  } else {
    payload = {
      event: 'submission.created',
      payload: {
        id: 'test-submission-id',
        formId: form.id,
        formTitle: form.title,
        data: {
          name: 'Test User',
          email: 'test@example.com',
          message: 'This is a test submission',
        },
        fileUrls: [],
        isSpam: false,
        spamReason: null,
        createdAt: new Date().toISOString(),
      },
    };
  }

  const logId = generateId(15);

  await db.insert(webhookDeliveryLogs).values({
    id: logId,
    formId,
    formDataId: lastSubmission?.id ?? null,
    webhookUrl,
    payload: JSON.stringify(payload),
    status: 'pending',
    attempts: 0,
  });

  const queue = getWebhookQueue();
  await queue.add(
    'deliver',
    {
      formId,
      formDataId: lastSubmission?.id ?? 'test',
      webhookUrl,
      payload,
      deliveryLogId: logId,
    },
    { jobId: logId },
  );

  return logId;
}
