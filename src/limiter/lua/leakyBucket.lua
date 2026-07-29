local key       = KEYS[1]
local capacity  = tonumber(ARGV[1])
local leakRate  = tonumber(ARGV[2])
local now       = tonumber(ARGV[3])
local ttl       = tonumber(ARGV[4])
local weight    = tonumber(ARGV[5])

local raw = redis.call('HMGET', key, 'level', 'lastUpdateTime')
local level          = tonumber(raw[1])
local lastUpdateTime = tonumber(raw[2])

if level == nil or lastUpdateTime == nil then
  level = 0
  lastUpdateTime = now
end

local elapsedSeconds = (now - lastUpdateTime) / 1000
local leaked = elapsedSeconds * leakRate
level = math.max(0, level - leaked)

local allowed = 0
local remaining = 0

if level + weight <= capacity then
  level = level + weight
  allowed = 1
  remaining = capacity - math.ceil(level)
else
  allowed = 0
  remaining = capacity - math.ceil(level)
end

-- Persist updated state
redis.call('HSET', key, 'level', tostring(level), 'lastUpdateTime', tostring(now))
redis.call('EXPIRE', key, ttl)

return { allowed, remaining }
