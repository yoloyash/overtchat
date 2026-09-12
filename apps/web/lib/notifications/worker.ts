import "server-only";
import { createHash } from "node:crypto";
import { and, eq, isNull, lte } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { deliveryDevice } from "@/lib/db/pushNotifications";
import { pushDevices, pushJobs } from "@/lib/db/schema";

type Job = typeof pushJobs.$inferSelect;
type ExpoResult = {
  status?: string;
  id?: string;
  details?: { error?: string };
};
const globals = globalThis as typeof globalThis & {
  overtchatPushWorker?: ReturnType<typeof setInterval>;
  overtchatPushBusy?: boolean;
};

async function expoRequest(path: string, body: unknown) {
  const token = process.env.EXPO_PUSH_ACCESS_TOKEN;
  const response = await fetch(`https://exp.host/--/api/v2/push/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    // Never log tokens, message bodies, or provider responses.
    throw new Error(`Push service returned HTTP ${response.status}`);
  }
  return (await response.json()) as {
    data?: ExpoResult | Record<string, ExpoResult>;
  };
}

function remove(job: Job) {
  db.delete(pushJobs).where(eq(pushJobs.id, job.id)).run();
}

function retry(job: Job) {
  if (job.attempts >= 5 || job.expiresAt <= Date.now()) {
    console.warn(
      "[push] Delivery attempts exhausted. Check Expo push credentials and outbound connectivity.",
    );
    remove(job);
    return;
  }
  db.update(pushJobs)
    .set({
      attempts: job.attempts + 1,
      nextAttemptAt: Date.now() + Math.min(300_000, 5_000 * 2 ** job.attempts),
    })
    .where(eq(pushJobs.id, job.id))
    .run();
}

async function deliver(job: Job) {
  // The next batch may have been cancelled while an earlier batch was sending.
  if (
    !db
      .select({ id: pushJobs.id })
      .from(pushJobs)
      .where(eq(pushJobs.id, job.id))
      .get()
  )
    return;
  if (job.expiresAt <= Date.now()) {
    remove(job);
    return;
  }
  const device = deliveryDevice(job);
  if (!device) {
    remove(job);
    return;
  }
  let result: ExpoResult | undefined;
  if (job.receiptId) {
    const response = await expoRequest("getReceipts", { ids: [job.receiptId] });
    result = (response.data as Record<string, ExpoResult> | undefined)?.[
      job.receiptId
    ];
    if (!result) {
      retry(job);
      return;
    }
  } else {
    const preview = device.previews ? job.body : "";
    const response = await expoRequest("send", {
      to: device.token,
      title: job.kind === "chat" ? "Your response is ready" : "Agent is idle",
      body:
        job.kind === "chat"
          ? preview || "Tap to view your response."
          : preview
            ? `${preview} · Tap to view the session.`
            : "Tap to view the session.",
      data: {
        kind: job.kind,
        targetId: job.targetId,
        registrationId: device.id,
        notificationId: job.id,
      },
      collapseId: createHash("sha256").update(job.id).digest("hex"),
      tag: job.id,
      channelId: job.kind === "chat" ? "chat-responses" : "agent-idle",
      sound: "default",
      priority: "high",
      ttl: Math.max(1, Math.floor((job.expiresAt - Date.now()) / 1000)),
    });
    result = response.data as ExpoResult | undefined;
  }
  if (result?.status === "ok") {
    if (job.receiptId) remove(job);
    else if (result.id)
      db.update(pushJobs)
        .set({
          receiptId: result.id,
          attempts: 0,
          nextAttemptAt: Date.now() + 15 * 60_000,
        })
        .where(eq(pushJobs.id, job.id))
        .run();
    else retry(job);
  } else if (result?.details?.error === "DeviceNotRegistered") {
    // Conditional token comparison protects a registration refreshed in flight.
    db.delete(pushDevices)
      .where(
        and(eq(pushDevices.id, device.id), eq(pushDevices.token, device.token)),
      )
      .run();
  } else if (result?.details?.error === "MessageTooBig") {
    remove(job);
  } else {
    retry(job);
  }
}

export async function flushPushNotifications() {
  if (globals.overtchatPushBusy) return;
  globals.overtchatPushBusy = true;
  try {
    db.delete(pushJobs).where(lte(pushJobs.expiresAt, Date.now())).run();
    const jobs = db
      .select()
      .from(pushJobs)
      .where(lte(pushJobs.nextAttemptAt, Date.now()))
      .limit(50)
      .all();
    // Bound concurrency; a single unavailable token should not block the queue.
    for (let index = 0; index < jobs.length; index += 5) {
      await Promise.all(
        jobs.slice(index, index + 5).map(async (job) => {
          try {
            await deliver(job);
          } catch {
            retry(job);
          }
        }),
      );
    }
  } finally {
    globals.overtchatPushBusy = false;
  }
}

export function startPushWorker() {
  if (globals.overtchatPushWorker) return;
  // Agent idle alerts are intentionally live-only in v1. A server restart must
  // not deliver an old idle alert after the connector resumes work.
  db.delete(pushJobs)
    .where(and(eq(pushJobs.kind, "agent"), isNull(pushJobs.receiptId)))
    .run();
  const tick = () =>
    void flushPushNotifications().catch(() =>
      console.error("[push] Queue processing failed."),
    );
  globals.overtchatPushWorker = setInterval(tick, 2_000);
  globals.overtchatPushWorker.unref();
  tick();
}
