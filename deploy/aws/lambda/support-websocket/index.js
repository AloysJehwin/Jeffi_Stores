const { Client } = require('pg')
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi')

const getDb = () => new Client({
  host: process.env.DB_HOST,
  port: 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
})

exports.connect = async (event) => {
  const connectionId = event.requestContext.connectionId
  const params = event.queryStringParameters || {}
  const userId = params.userId
  const sessionId = params.sessionId
  const role = params.role || 'user'

  if (!userId || !sessionId) {
    return { statusCode: 400, body: 'Missing userId or sessionId' }
  }

  const db = getDb()
  await db.connect()
  try {
    await db.query(
      `INSERT INTO websocket_connections (connection_id, user_id, session_id, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (connection_id) DO UPDATE SET session_id = $3, role = $4`,
      [connectionId, userId, sessionId, role]
    )
    return { statusCode: 200, body: 'Connected' }
  } finally {
    await db.end()
  }
}

exports.disconnect = async (event) => {
  const connectionId = event.requestContext.connectionId
  const db = getDb()
  await db.connect()
  try {
    await db.query('DELETE FROM websocket_connections WHERE connection_id = $1', [connectionId])
    return { statusCode: 200, body: 'Disconnected' }
  } finally {
    await db.end()
  }
}

exports.sendMessage = async (event) => {
  const connectionId = event.requestContext.connectionId
  const domain = event.requestContext.domainName
  const stage = event.requestContext.stage
  const body = JSON.parse(event.body || '{}')
  const { message, sessionId } = body

  if (!message || !sessionId) {
    return { statusCode: 400, body: 'Missing message or sessionId' }
  }

  const db = getDb()
  await db.connect()
  try {
    const connResult = await db.query(
      'SELECT role FROM websocket_connections WHERE connection_id = $1',
      [connectionId]
    )
    if (!connResult.rows.length) {
      return { statusCode: 403, body: 'Unknown connection' }
    }

    const sender = connResult.rows[0].role

    const msgResult = await db.query(
      `INSERT INTO support_messages (session_id, sender, message)
       VALUES ($1, $2, $3)
       RETURNING id, session_id, sender, message, created_at`,
      [sessionId, sender, message]
    )
    const newMessage = msgResult.rows[0]

    const peersResult = await db.query(
      'SELECT connection_id FROM websocket_connections WHERE session_id = $1 AND connection_id != $2',
      [sessionId, connectionId]
    )

    const apigw = new ApiGatewayManagementApiClient({
      endpoint: `https://${domain}/${stage}`,
    })

    const payload = JSON.stringify({ type: 'new-message', message: newMessage })

    const sendPromises = peersResult.rows.map(async (row) => {
      try {
        await apigw.send(new PostToConnectionCommand({
          ConnectionId: row.connection_id,
          Data: Buffer.from(payload),
        }))
      } catch (_err) {
        await db.query('DELETE FROM websocket_connections WHERE connection_id = $1', [row.connection_id])
      }
    })

    const selfPayload = JSON.stringify({ type: 'message-ack', message: newMessage })
    sendPromises.push(
      apigw.send(new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: Buffer.from(selfPayload),
      })).catch(() => {})
    )

    await Promise.all(sendPromises)
    return { statusCode: 200, body: 'OK' }
  } finally {
    await db.end()
  }
}

exports.closeSession = async (event) => {
  const connectionId = event.requestContext.connectionId
  const body = JSON.parse(event.body || '{}')
  const { sessionId } = body

  if (!sessionId) {
    return { statusCode: 400, body: 'Missing sessionId' }
  }

  const db = getDb()
  await db.connect()
  try {
    const connResult = await db.query(
      'SELECT role FROM websocket_connections WHERE connection_id = $1',
      [connectionId]
    )
    if (!connResult.rows.length || connResult.rows[0].role !== 'user') {
      return { statusCode: 403, body: 'Only the customer can close the session' }
    }

    await db.query(
      `UPDATE support_sessions SET status = 'closed', closed_at = NOW() WHERE id = $1`,
      [sessionId]
    )

    const peersResult = await db.query(
      'SELECT connection_id FROM websocket_connections WHERE session_id = $1 AND connection_id != $2',
      [sessionId, connectionId]
    )

    const domain = event.requestContext.domainName
    const stage = event.requestContext.stage
    const apigw = new ApiGatewayManagementApiClient({
      endpoint: `https://${domain}/${stage}`,
    })

    const payload = JSON.stringify({ type: 'session-closed', sessionId })
    await Promise.all(peersResult.rows.map((row) =>
      apigw.send(new PostToConnectionCommand({
        ConnectionId: row.connection_id,
        Data: Buffer.from(payload),
      })).catch(() => {})
    ))

    await db.query('DELETE FROM websocket_connections WHERE session_id = $1', [sessionId])
    return { statusCode: 200, body: 'Session closed' }
  } finally {
    await db.end()
  }
}
