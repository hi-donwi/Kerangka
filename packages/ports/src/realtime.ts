/**
 * Kerangka Realtime Port Contract
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

export interface RealtimePort {
  /**
   * Broadcasts a message to all connected clients on a given channel or topic.
   */
  broadcast(channel: string, message: unknown): Promise<void>;

  /**
   * Sends a targeted message to a specific authenticated user session.
   */
  sendToUser(userId: string, message: unknown): Promise<void>;
}
