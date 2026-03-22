export interface SyncOperation {
  table: string;
  type: 'upsert' | 'delete';
  payload: Record<string, unknown>;
  created_at: string;
  pending_sync: boolean;
}
