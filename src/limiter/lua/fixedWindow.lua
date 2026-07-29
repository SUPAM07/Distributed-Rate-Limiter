local key    = KEYS[1]
local limit  = tonumber(ARGV[1])
local ttl    = tonumber(ARGV[2])
local weight = tonumber(ARGV[3])

local count = tonumber(redis.call('GET', key) or "0")

local allowed = 0
local remaining = 0

if count + weight <= limit then
  count = redis.call('INCRBY', key, weight)
  if count == weight then
    redis.call('EXPIRE', key, ttl)
  end
  allowed = 1
  remaining = limit - count
else
  allowed = 0
  remaining = math.max(0, limit - count)
end

return { allowed, remaining }
