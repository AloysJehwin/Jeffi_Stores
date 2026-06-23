import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock the AWS SDK — ApiGatewayManagementApiClient must be a class (constructor)
// ---------------------------------------------------------------------------
const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }))

vi.mock('@aws-sdk/client-apigatewaymanagementapi', () => ({
  ApiGatewayManagementApiClient: vi.fn().mockImplementation(function (this: any, config: any) {
    this.config = config
    this.send = mockSend
  }),
  PostToConnectionCommand: vi.fn().mockImplementation(function (this: any, input: any) { Object.assign(this, input) }),
}))

import { pushToConnection, getWsEndpoint } from '@/lib/websocket'
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi'

describe('pushToConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSend.mockResolvedValue({})
  })

  it('creates a client with the provided endpoint', async () => {
    await pushToConnection('https://example.execute-api.us-east-1.amazonaws.com/prod', 'conn-123', { type: 'ping' })
    expect(ApiGatewayManagementApiClient).toHaveBeenCalledWith({
      endpoint: 'https://example.execute-api.us-east-1.amazonaws.com/prod',
    })
  })

  it('sends a PostToConnectionCommand with the connection id', async () => {
    await pushToConnection('https://ws.endpoint.com', 'conn-abc', { msg: 'hello' })
    expect(mockSend).toHaveBeenCalledOnce()
    const cmdArg = (mockSend.mock.calls[0][0] as any)
    expect(cmdArg.ConnectionId).toBe('conn-abc')
  })

  it('encodes the payload as JSON buffer', async () => {
    const payload = { event: 'order_update', orderId: 'ord-001' }
    await pushToConnection('https://ws.endpoint.com', 'conn-abc', payload)
    const cmdArg = (mockSend.mock.calls[0][0] as any)
    const decoded = JSON.parse(Buffer.from(cmdArg.Data).toString())
    expect(decoded).toEqual(payload)
  })

  it('propagates errors from client.send', async () => {
    mockSend.mockRejectedValue(new Error('GoneException'))
    await expect(
      pushToConnection('https://ws.endpoint.com', 'gone-conn', { x: 1 })
    ).rejects.toThrow('GoneException')
  })
})

describe('getWsEndpoint', () => {
  beforeEach(() => {
    delete process.env.WS_API_ID
    delete process.env.WS_REGION
  })

  it('builds endpoint from WS_API_ID and WS_REGION', () => {
    process.env.WS_API_ID = 'abc123xyz'
    process.env.WS_REGION = 'ap-south-1'
    const ep = getWsEndpoint()
    expect(ep).toBe('https://abc123xyz.execute-api.ap-south-1.amazonaws.com/prod')
  })

  it('defaults region to us-east-1 when WS_REGION is not set', () => {
    process.env.WS_API_ID = 'myapi'
    const ep = getWsEndpoint()
    expect(ep).toContain('us-east-1')
  })

  it('uses undefined api id when WS_API_ID is not set', () => {
    process.env.WS_REGION = 'eu-west-1'
    const ep = getWsEndpoint()
    expect(ep).toContain('execute-api.eu-west-1.amazonaws.com/prod')
  })
})
