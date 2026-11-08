/** Public connection metadata. Credentials are never included in this shape. */
export interface ManagedConnection {
  id: string;
  name: string;
  baseUrl: string;
  externalCaseId: string;
  merchantName: string;
  merchantId: string;
  orderRef: string;
  paymentRef: string;
  status: 'connected' | 'disconnected';
  verifiedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ManagedConnectorListResponse {
  connections: ManagedConnection[];
  storage: 'aws';
}

export interface ManagedConnectorActionResponse {
  connection: ManagedConnection;
}

export type ManagedConnectorAction =
  | { action: 'connect'; name: string; baseUrl: string; token: string; externalCaseId: string }
  | { action: 'recheck' | 'disconnect' | 'import'; connectionId: string };
