echo "dump all keys"
redis-cli -p 6380 KEYS "*"

#key="211e06bc-d0a1-4a76-83f7-357902d015ab"
key="_portal.test123.2.b.ii"

echo "hgetall $key"
redis-cli -p 6380 hgetall $key

echo "hgetall $key .1"
redis-cli -p 6380 hgetall "${key}.1"
