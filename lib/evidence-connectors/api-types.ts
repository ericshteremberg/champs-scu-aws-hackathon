import type { ConnectorManifest, ConnectorPreview, ConnectorTemplate } from './types.ts';

/** Public configuration only. Database credentials and case tokens never belong here. */
export interface EvidenceConnection {
  id: string;
  name: string;
  templateId: string;
  manifest: ConnectorManifest;
  status: 'demo_ready' | 'revoked';
  createdAt: string;
  updatedAt: string;
}

export interface ConnectorListResponse {
  templates: ConnectorTemplate[];
  connections: EvidenceConnection[];
  storage: 'aws';
  setupMode: 'guided';
}

export interface ConnectorInstallResponse {
  files: { name: string; content: string }[];
  instructions: string[];
}

export interface ConnectorPreviewResponse { preview: ConnectorPreview }
