export interface NotificationPayload {
  userId: string;
  title: string;
  message: string;
  type: string;
  data?: Record<string, unknown>;
}
