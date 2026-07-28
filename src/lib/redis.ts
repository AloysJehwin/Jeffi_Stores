let redisClient: any | null = null

export function getRedisClient(): any {
  if (redisClient) {
    return redisClient
  }

  const redisUrl = process.env.REDIS_URL || process.env.UPSTASH_REDIS_URL

  if (!redisUrl) {
    return (redisClient = createInMemoryRedis())
  }

  try {
    // ioredis is server-only. require() here so webpack can alias it to a stub
    // on the client bundle without breaking the server-side runtime.
    const RedisModule = require('ioredis') // noqa
    const Redis = RedisModule.default || RedisModule
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => {
        if (times > 3) return null
        return Math.min(times * 200, 1000)
      },
    })
    redisClient.on('error', () => {})
    redisClient.on('connect', () => {})
    return redisClient
  } catch {
    return (redisClient = createInMemoryRedis())
  }
}

function createInMemoryRedis(): any {
  const store = new Map<string, { value: string; expiry?: number }>()
  const mockRedis = {
    async set(key: string, value: string, ...args: any[]): Promise<'OK'> {
      const entry: { value: string; expiry?: number } = { value }
      if (args[0] === 'EX' && args[1]) entry.expiry = Date.now() + args[1] * 1000
      if (args[0] === 'PX' && args[1]) entry.expiry = Date.now() + args[1]
      store.set(key, entry)
      return 'OK'
    },
    async get(key: string): Promise<string | null> {
      const entry = store.get(key)
      if (!entry) return null
      if (entry.expiry && Date.now() > entry.expiry) { store.delete(key); return null }
      return entry.value
    },
    async del(key: string): Promise<number> {
      const existed = store.has(key)
      store.delete(key)
      return existed ? 1 : 0
    },
    async incr(key: string): Promise<number> {
      const entry = store.get(key)
      const current = entry ? parseInt(entry.value) || 0 : 0
      const newValue = current + 1
      store.set(key, { value: String(newValue), expiry: entry?.expiry })
      return newValue
    },
    async ttl(key: string): Promise<number> {
      const entry = store.get(key)
      if (!entry || !entry.expiry) return -1
      const remaining = Math.floor((entry.expiry - Date.now()) / 1000)
      return remaining > 0 ? remaining : -2
    },
    on: () => {},
  } as any
  return mockRedis
}

const lazyRedis = new Proxy({} as any, {
  get(_target, prop) {
    return getRedisClient()[prop]
  },
})

export default lazyRedis
