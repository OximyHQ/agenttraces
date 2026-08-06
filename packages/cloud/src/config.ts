export interface CloudConfig {
  databaseUrl: string;
  redisUrl: string;
  s3Endpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
}

function required(name: string, alternatives: string[] = []) {
  for (const key of [name, ...alternatives]) if (process.env[key]) return process.env[key]!;
  throw new Error(`Missing ${[name, ...alternatives].join(' or ')}`);
}

export function cloudConfig(): CloudConfig {
  return {
    databaseUrl: required("DATABASE_URL"),
    redisUrl: required("REDIS_URL"),
    s3Endpoint: required("S3_ENDPOINT", ["BUCKET_ENDPOINT"]),
    s3Region: process.env.S3_REGION ?? process.env.BUCKET_REGION ?? "sjc",
    s3Bucket: required("S3_BUCKET", ["BUCKET_NAME"]),
    s3AccessKeyId: required("S3_ACCESS_KEY_ID", ["BUCKET_ACCESS_KEY_ID"]),
    s3SecretAccessKey: required("S3_SECRET_ACCESS_KEY", ["BUCKET_SECRET_ACCESS_KEY"]),
  };
}
