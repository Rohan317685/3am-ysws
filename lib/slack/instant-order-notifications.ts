import { sendSlackDm } from "@/lib/slack/notifications";

type InstantOrderEvent = {
  event: "created" | "shipped";
  orderId: string;
  makerName: string;
  itemName: string;
  cost: number;
  tracking?: string | null;
};

function recipients(): string[] {
  return [...new Set([
    process.env.SLACK_ORDER_DIGEST_USER_ID,
    ...(process.env.ORGANIZER_SLACK_IDS ?? "").split(","),
  ].map((value) => value?.trim()).filter((value): value is string =>
    typeof value === "string" && /^[UW][A-Z0-9]+$/.test(value)
  ))];
}

function escapeSlackText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Sends each order event immediately; deliberately does not enqueue it for a scheduled digest. */
export async function notifyOrderEventInstant(input: InstantOrderEvent): Promise<void> {
  const orderUrl = process.env.APP_URL?.trim();
  let link = "";
  if (orderUrl) {
    try {
      const base = new URL(orderUrl);
      if (base.protocol === "https:" || base.hostname === "localhost" || base.hostname === "127.0.0.1") {
        link = `\n<${new URL("/dash/orders", base).toString()}|Open orders dashboard>`;
      }
    } catch {
      // Notification still sends without a dashboard link.
    }
  }

  const title = input.event === "created" ? "🛒 *New 3AM shop order*" : "📦 *3AM order shipped*";
  const tracking = input.event === "shipped" && input.tracking?.trim()
    ? `\n*Tracking:* ${escapeSlackText(input.tracking.trim())}`
    : "";
  await Promise.all(recipients().map(async (slackId) => {
    const message = [
      `📬 <@${slackId}> ${title}`,
      `*Item:* ${escapeSlackText(input.itemName)}`,
      `*Maker:* ${escapeSlackText(input.makerName || "Unknown maker")}`,
      `*Cost:* ${input.cost} beans`,
      `*Order:* `${escapeSlackText(input.orderId.slice(0, 8))}``,
      tracking,
      link,
    ].filter(Boolean).join("\n");
    try {
      await sendSlackDm(slackId, message);
    } catch {
      console.warn("[slack] immediate order notification failed");
    }
  }));
}
