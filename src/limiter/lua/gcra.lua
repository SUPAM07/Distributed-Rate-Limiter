local key              = KEYS[1]
local emissionInterval = tonumber(ARGV[1])
local burstTolerance   = tonumber(ARGV[2])
local now              = tonumber(ARGV[3])
local ttl              = tonumber(ARGV[4])
local weight           = tonumber(ARGV[5])

local tat = tonumber(redis.call('GET', key) or "0")

if tat < now then
  tat = now
end

local increment = weight * emissionInterval
local newTat = tat + increment

local allowed = 0
local retryAfterMs = 0

-- The theoretical limit time is now + burstTolerance.
-- If newTat exceeds this, the request is rejected.
local limitTime = now + burstTolerance

if newTat <= limitTime then
  redis.call('SET', key, tostring(newTat), 'EX', ttl)
  allowed = 1
  tat = newTat
else
  allowed = 0
  -- If rejected, the retry time is when TAT drops enough to allow 'weight' increment
  -- Time required = newTat - limitTime
  retryAfterMs = newTat - limitTime
end

-- Remaining capacity can be estimated from how far TAT is from limitTime
-- remaining = (limitTime - tat) / emissionInterval
local remainingRaw = (limitTime - tat) / emissionInterval
local remaining = math.floor(math.max(0, remainingRaw))

return { allowed, remaining, tat, retryAfterMs }
