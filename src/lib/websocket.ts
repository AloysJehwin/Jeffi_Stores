import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi'

export async function pushToConnection(
  endpoint: string,
  connectionId: string,
  payload: object
): Promise<void> {
  const client = new ApiGatewayManagementApiClient({ endpoint })
  await client.send(new PostToConnectionCommand({
    ConnectionId: connectionId,
    Data: Buffer.from(JSON.stringify(payload)),
  }))
}

export function getWsEndpoint(): string {
  const apiId = process.env.WS_API_ID
  const region = process.env.WS_REGION || 'us-east-1'
  return `https://${apiId}.execute-api.${region}.amazonaws.com/prod`
}
