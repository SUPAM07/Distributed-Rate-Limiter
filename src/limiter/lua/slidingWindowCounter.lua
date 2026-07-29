local key = KEYS[1]
local limit = tonumber(ARGV[1])
local now = tonumber(ARGV[2])
local currStart = ARGV[3]
local prevStart = ARGV[4]
local windowMs = tonumber(ARGV[5])
local ttl = tonumber(ARGV[6])
local weight = tonumber(ARGV[7])

local counts = redis.call('HMGET', key, prevStart, currStart)
local prevCount = tonumber(counts[1]) or 0
local currCount = tonumber(counts[2]) or 0

local elapsedInCurrent = now - tonumber(currStart)
local weightFactor = math.max(0, (windowMs - elapsedInCurrent) / windowMs)
local estimatedCount = (prevCount * weightFactor) + currCount

local allowed = 0
local remaining = 0

if estimatedCount + weight <= limit then
  currCount = redis.call('HINCRBY', key, currStart, weight)
  redis.call('EXPIRE', key, ttl)
  allowed = 1
  estimatedCount = (prevCount * weightFactor) + currCount
  remaining = math.max(0, limit - math.floor(estimatedCount))
else
  allowed = 0
  remaining = math.max(0, limit - math.floor(estimatedCount))
end

return { allowed, remaining, estimatedCount }
