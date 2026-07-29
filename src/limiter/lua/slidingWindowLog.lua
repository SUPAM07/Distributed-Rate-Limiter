local key = KEYS[1]
local limit = tonumber(ARGV[1])
local now = tonumber(ARGV[2])
local windowStart = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local memberId = ARGV[5]
local weight = tonumber(ARGV[6])

redis.call('ZREMRANGEBYSCORE', key, '-inf', windowStart)

local count = tonumber(redis.call('ZCARD', key) or "0")

local allowed = 0
local remaining = 0

if count + weight <= limit then
  -- Add one entry per weight unit to correctly track capacity
  -- We batch them into a single ZADD call for efficiency
  local zaddArgs = {}
  for i=1, weight do
    table.insert(zaddArgs, now)
    table.insert(zaddArgs, memberId .. '-' .. i)
  end
  if #zaddArgs > 0 then
    redis.call('ZADD', key, unpack(zaddArgs))
    redis.call('EXPIRE', key, ttl)
  end
  allowed = 1
  remaining = limit - count - weight
else
  allowed = 0
  remaining = math.max(0, limit - count)
end

local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local oldestScore = 0
if oldest[2] then
  oldestScore = tonumber(oldest[2])
end

return { allowed, remaining, oldestScore }
