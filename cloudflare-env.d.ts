declare namespace Cloudflare {
  interface Env {
    DEPLOYMENT_MODE?: string;
    DEV_ACCESS_PASSWORD?: string;
    DATA_BACKEND?: string;
    AWS_BACKEND_FUNCTION?: string;
    EVIDENCE_BUCKET_ORIGIN?: string;
    ASSETS?: Fetcher;
    DB?: D1Database;
    BUCKET?: R2Bucket;
    AWS_REGION?: string;
    AWS_ACCESS_KEY_ID?: string;
    AWS_SECRET_ACCESS_KEY?: string;
    AWS_SESSION_TOKEN?: string;
    BEDROCK_MODEL_ID?: string;
    MERCHANT_EVIDENCE_URL?: string;
    MERCHANT_EVIDENCE_TOKEN?: string;
    MERCHANT_WORKSPACE_ID?: string;
    S3_EVIDENCE_BUCKET?: string;
  }
}
