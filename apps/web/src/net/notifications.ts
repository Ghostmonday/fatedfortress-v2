/**
 * apps/web/src/net/notifications.ts — Supabase Realtime notification client.
 *
 * Subscribes to the notifications table for the current user and dispatches
 * DOM custom events so UI components can react without prop-drilling.
 */

import { getSupabase } from "../auth/index.js";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { NotificationType } from "@fatedfortress/protocol";

export type { NotificationType };

export interface NotificationPayload {
  id: string;
  user_id: string;
  type: NotificationType;
  task_id: string | null;
  read: boolean;
  created_at: string;
}

const CHANNEL_NAME = "notifications";

let channel: RealtimeChannel | null = null;

/**
 * Subscribe to real-time notifications for the current user.
 * Dispatches `ff:notification` custom events on document.
 */
export function subscribeToNotifications(userId: string): RealtimeChannel {
  if (channel) {
    channel.unsubscribe();
  }

  channel = getSupabase()
    .channel(CHANNEL_NAME)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "notifications",
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        const notif = payload.new as NotificationPayload;
        document.dispatchEvent(
          new CustomEvent("ff:notification", { detail: notif })
        );
        // Also dispatch typed events
        document.dispatchEvent(
          new CustomEvent(`ff:notification:${notif.type}`, { detail: notif })
        );
      }
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "notifications",
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        const notif = payload.new as NotificationPayload;
        document.dispatchEvent(
          new CustomEvent("ff:notification:read", { detail: notif })
        );
      }
    )
    .subscribe();

  return channel;
}

export function unsubscribeFromNotifications(): void {
  if (channel) {
    channel.unsubscribe();
    channel = null;
  }
}

/** Mark a notification as read */
export async function markNotificationRead(notificationId: string): Promise<void> {
  const { error } = await getSupabase()
    .from("notifications")
    .update({ read: true })
    .eq("id", notificationId);
  if (error) console.error("[notifications] markRead failed:", error);
}

/** Mark all notifications as read for current user */
export async function markAllNotificationsRead(userId: string): Promise<void> {
  const { error } = await getSupabase()
    .from("notifications")
    .update({ read: true })
    .eq("user_id", userId)
    .eq("read", false);
  if (error) console.error("[notifications] markAllRead failed:", error);
}

/** Fetch unread count */
export async function getUnreadCount(userId: string): Promise<number> {
  const { count, error } = await getSupabase()
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("read", false);
  if (error) return 0;
  return count ?? 0;
}
