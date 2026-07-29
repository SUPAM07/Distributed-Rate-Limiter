local key            = KEYS[1]
local capacity       = tonumber(ARGV[1])
local refillRate     = tonumber(ARGV[2])
local now            = tonumber(ARGV[3])
local ttl            = tonumber(ARGV[4])
local weight         = tonumber(ARGV[5])

local raw = redis.call('HMGET', key, 'tokens', 'lastRefillTime')
local tokens         = tonumber(raw[1])
local lastRefillTime = tonumber(raw[2])

if tokens == nil or lastRefillTime == nil then
  tokens         = capacity
  lastRefillTime = now
end

local elapsedSeconds = (now - lastRefillTime) / 1000
local refilled       = elapsedSeconds * refillRate
tokens = math.min(capacity, tokens + refilled)

local allowed   = 0
local remaining = 0

if tokens >= weight then
  tokens    = tokens - weight
  allowed   = 1
  remaining = math.floor(tokens)
else
  remaining = math.floor(tokens)
end

redis.call('HSET',   key, 'tokens', tostring(tokens), 'lastRefillTime', tostring(now))
redis.call('EXPIRE', key, ttl)

return { allowed, remaining }
