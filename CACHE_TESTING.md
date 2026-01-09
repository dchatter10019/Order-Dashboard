# 🧪 Testing Guide for Caching System

## Overview
This guide explains how to test the new intelligent caching system that:
- Pre-loads last 30 days of data on server startup
- Caches orders by individual dates
- Only fetches missing dates from the API
- Merges cached and newly fetched data

## 🚀 Step 1: Start the Server

### Option A: Production Mode
```bash
npm run build
npm start
```

### Option B: Development Mode
```bash
npm run dev:full
```

## 📊 Step 2: Observe Startup Cache Loading

When the server starts, you should see logs like:

```
🚀 Bevvi Order Tracking System server running on port 3001
📅 Fetching last 30 days of orders on startup...
   Date range: 2024-12-05 to 2025-01-04
   Fetching chunk 1/1: 2024-12-05 to 2025-01-04
   ✅ Chunk 1 complete: 150 orders
✅ Startup data load complete: 150 orders cached
📦 Loading all Bevvi products on startup...
✅ Server ready with products cache loaded
```

**What to check:**
- ✅ Server logs show "Fetching last 30 days of orders on startup"
- ✅ You see chunk processing logs
- ✅ Final count shows orders were cached
- ✅ Server continues even if some chunks fail

## 🔍 Step 3: Test Cache Hit (Using Cached Data)

### Test via Browser/UI:
1. Open http://localhost:3001
2. Login with `Bevvi_User` / `Bevvi_123#`
3. Go to Dashboard
4. Select a date range within the last 30 days (e.g., today to 7 days ago)
5. Click "Fetch Orders"

**Expected behavior:**
- ✅ Orders load quickly (from cache)
- ✅ Server logs show: `✅ Returning merged cached data - Orders: X`
- ✅ Response includes `"cached": true` in the API response

### Test via API Directly:
```bash
# Request data for dates that were pre-loaded
curl "http://localhost:3001/api/orders?startDate=2025-01-01&endDate=2025-01-03"
```

**Check server logs for:**
```
🔍 Cache check for 2025-01-01 to 2025-01-03:
   Cached dates: 3 / 3
   Missing ranges: 0
   Cached orders found: 45
✅ Returning merged cached data - Orders: 45
```

## 🌐 Step 4: Test Cache Miss (Fetching New Data)

### Test via Browser/UI:
1. Select a date range that includes dates NOT in the last 30 days
   - Example: 60 days ago to 35 days ago
2. Click "Fetch Orders"

**Expected behavior:**
- ✅ Server logs show: `🌐 Fetching missing date ranges from Bevvi API...`
- ✅ Only the missing date ranges are fetched
- ✅ Response includes `"source": "Bevvi API (merged with cache)"` if some dates were cached

### Test via API:
```bash
# Request data for dates outside the pre-loaded range
curl "http://localhost:3001/api/orders?startDate=2024-11-01&endDate=2024-11-05"
```

**Check server logs for:**
```
🔍 Cache check for 2024-11-01 to 2024-11-05:
   Cached dates: 0 / 5
   Missing ranges: 1
   Cached orders found: 0
🌐 Fetching missing date ranges from Bevvi API...
   Need to fetch 1 date range(s)
🔄 Fetching missing range 1/1: 2024-11-01 to 2024-11-05 (5 days)
   ✅ Range 1 complete: 25 orders
✅ Total orders after merge: 25 (0 from cache, 25 newly fetched)
```

## 🔄 Step 5: Test Partial Cache (Mixed Scenario)

### Test via Browser/UI:
1. Select a date range that spans both cached and uncached dates
   - Example: 35 days ago (not cached) to today (cached)
2. Click "Fetch Orders"

**Expected behavior:**
- ✅ Server logs show some dates are cached, some are missing
- ✅ Only missing date ranges are fetched from API
- ✅ Cached and new data are merged together
- ✅ Response shows total count includes both sources

### Test via API:
```bash
# Request data spanning cached and uncached dates
curl "http://localhost:3001/api/orders?startDate=2024-12-01&endDate=2025-01-05"
```

**Check server logs for:**
```
🔍 Cache check for 2024-12-01 to 2025-01-05:
   Cached dates: 30 / 36
   Missing ranges: 1
   Cached orders found: 120
🌐 Fetching missing date ranges from Bevvi API...
   Need to fetch 1 date range(s)
🔄 Fetching missing range 1/1: 2024-12-01 to 2024-12-05 (5 days)
   ✅ Range 1 complete: 20 orders
✅ Total orders after merge: 140 (120 from cache, 20 newly fetched)
```

## 📈 Step 6: Verify Cache Persistence

### Test Multiple Requests:
1. Make the same API request twice in quick succession:
```bash
curl "http://localhost:3001/api/orders?startDate=2025-01-01&endDate=2025-01-03"
# Wait 1 second
curl "http://localhost:3001/api/orders?startDate=2025-01-01&endDate=2025-01-03"
```

**Expected behavior:**
- ✅ First request: May fetch from API or use cache
- ✅ Second request: Should use cache (much faster)
- ✅ Server logs show `✅ Returning full-range cached data` or `✅ Returning merged cached data`

## 🧹 Step 7: Test Cache After Server Restart

1. Stop the server (Ctrl+C)
2. Start it again
3. Make a request for dates in the last 30 days

**Expected behavior:**
- ✅ Server pre-loads last 30 days again on startup
- ✅ Request uses the newly cached data
- ✅ No API calls needed for dates within the pre-loaded range

## 🐛 Debugging Tips

### Check Cache Status:
Look for these log patterns:

**Cache Hit:**
```
🔍 Cache check for X to Y:
   Cached dates: N / M
   Missing ranges: 0
✅ Returning merged cached data - Orders: X
```

**Cache Miss:**
```
🔍 Cache check for X to Y:
   Cached dates: 0 / M
   Missing ranges: 1
🌐 Fetching missing date ranges from Bevvi API...
```

**Partial Cache:**
```
🔍 Cache check for X to Y:
   Cached dates: N / M  (where N < M)
   Missing ranges: 1
   Cached orders found: X
🌐 Fetching missing date ranges from Bevvi API...
```

### Common Issues:

1. **No startup data loading:**
   - Check if server logs show the startup fetch
   - Verify API is accessible
   - Check for errors in startup logs

2. **Cache not working:**
   - Verify `ordersByDateCache` and `allCachedOrders` are being populated
   - Check server logs for cache check results
   - Ensure dates match exactly (YYYY-MM-DD format)

3. **Always fetching from API:**
   - Check if cache is being cleared somewhere
   - Verify date format matches between requests
   - Check if cache duration expired (5 minutes default)

## ✅ Success Criteria

Your caching system is working correctly if:

1. ✅ Server pre-loads last 30 days on startup
2. ✅ Requests for cached dates return quickly without API calls
3. ✅ Requests for uncached dates fetch only missing ranges
4. ✅ Mixed requests merge cached and fetched data correctly
5. ✅ Server logs clearly show cache hits/misses
6. ✅ API responses include `"cached": true` when using cache
7. ✅ No duplicate orders in merged results

## 📝 Test Checklist

- [ ] Server startup loads last 30 days
- [ ] Cached date requests use cache (no API call)
- [ ] Uncached date requests fetch from API
- [ ] Mixed requests merge cached + fetched data
- [ ] Multiple requests for same range use cache
- [ ] Server restart re-loads cache
- [ ] No duplicate orders in results
- [ ] Performance is faster for cached requests

## 🎯 Performance Expectations

- **Cached requests**: < 100ms response time
- **API requests**: 1-5 seconds (depending on date range)
- **Startup cache load**: 10-30 seconds (for 30 days)
- **Memory usage**: ~1-5MB per 1000 orders cached


