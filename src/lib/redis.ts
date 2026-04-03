import Redis from 'ioredis'

let redisClient: Redis | null = null

export function getRedisClient(): Redis {
  if (redisClient) {
    return redisClient
  }

  // Check if Redis URL is configured
  const redisUrl = process.env.REDIS_URL || process.env.UPSTASH_REDIS_URL

  if (!redisUrl) {
    console.warn('⚠️  No Redis URL configured. Using in-memory fallback (not suitable for production)')
    // Return a mock Redis client for development
    return createInMemoryRedis()
  }

  try {
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 3) {
          console.error('Redis connection failed after 3 retries')
          return null
        }
        return Math.min(times * 200, 1000)
      },
    })

    redisClient.on('error', (err) => {
      console.error('Redis error:', err)
    })

    redisClient.on('connect', () => {
      console.log('✅ Connected to Redis')
    })

    return redisClient
  } catch (error) {
    console.error('Failed to create Redis client:', error)
    return createInMemoryRedis()
  }
}

// In-memory fallback for development without Redis
function createInMemoryRedis(): Redis {
  const store = new Map<string, { value: string; expiry?: number }>()

  const mockRedis = {
    async set(key: string, value: string, ...args: any[]): Promise<'OK'> {
      const entry: { value: string; expiry?: number } = { value }
      
      // Handle EX (seconds) expiry
      if (args[0] === 'EX' && args[1]) {
        entry.expiry = Date.now() + args[1] * 1000
      }
      
      store.set(key, entry)
      return 'OK'
    },

    async get(key: string): Promise<string | null> {
      const entry = store.get(key)
      if (!entry) return null
      
      // Check expiry
      if (entry.expiry && Date.now() > entry.expiry) {
        store.delete(key)
        return null
      }
      
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

  console.log('⚠️  Using in-memory Redis fallback')
  return mockRedis as Redis
}

// Export a singleton instance
const redisInstance = getRedisClient()
export default redisInstance
