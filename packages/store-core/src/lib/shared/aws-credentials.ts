/**
 * Static AWS keys only when both are set. Otherwise undefined, so the SDK's default chain resolves
 * credentials: env, AWS_WEB_IDENTITY_TOKEN_FILE + AWS_ROLE_ARN (the cluster's IRSA on Azure), ECS,
 * then EC2 instance metadata. Never blank keys.
 */
export function staticAwsCredentials(
  env: Record<string, string | undefined> = process.env
): { accessKeyId: string; secretAccessKey: string; sessionToken?: string } | undefined {
  const accessKeyId = env.AWS_ACCESS_KEY_ID
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY
  if (!accessKeyId || !secretAccessKey) return undefined
  return { accessKeyId, secretAccessKey, ...(env.AWS_SESSION_TOKEN ? { sessionToken: env.AWS_SESSION_TOKEN } : {}) }
}
