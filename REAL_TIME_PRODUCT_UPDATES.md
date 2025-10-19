# Real-Time Product Updates

## Overview
The Product Management system now queries the Bevvi API in real-time with every search, ensuring you always see the most up-to-date product masterlist.

## How It Works

### 1. **On-Demand API Search**
Every time you type in the product search box:
- System waits 150ms after you stop typing
- Sends a fresh API request to Bevvi
- Returns the latest matching products from the database
- No client-side caching of product data

### 2. **Cache-Busting**
To ensure absolutely fresh data, we implement:

```javascript
// Timestamp parameter prevents any caching
const cacheBuster = `t=${Date.now()}`

// No-cache headers force fresh data
headers: {
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  'Pragma': 'no-cache'
}
```

### 3. **Real-Time Flow**
```
Product masterlist updated in Bevvi
    ↓
User searches in Product Management
    ↓
API query sent with cache-busting
    ↓
Latest data returned from database
    ↓
User sees updated products immediately
```

## How to See Updated Products

### Method 1: Re-Type Your Search (Recommended)
1. Clear the search box
2. Type your search term again (3+ characters)
3. Fresh results appear in <1 second

### Method 2: Use "Refresh Search" Button
1. Click the **"Refresh Search"** button next to the Product label
2. Forces immediate re-query of the API
3. Shows updated results instantly

### Method 3: Slightly Modify Search
1. Add/remove a character from your search
2. System automatically searches again
3. Fresh results appear

## Common Scenarios

### Scenario 1: New Product Added to Bevvi
**Problem**: Just added a new product to Bevvi, don't see it in search

**Solution**:
1. Type the product name in the search box
2. If it doesn't appear, click "Refresh Search"
3. The new product should now appear

### Scenario 2: Product Name/UPC Changed
**Problem**: Product details were updated in Bevvi, search shows old info

**Solution**:
1. Clear your search and re-type
2. Or click "Refresh Search" button
3. Updated information will appear

### Scenario 3: Product Deactivated
**Problem**: Product was deactivated but still appearing in search

**Solution**:
- Our search filters to `isActive: true` only
- Click "Refresh Search" to update results
- Deactivated products will no longer appear

### Scenario 4: After Adding Product via Form
**Problem**: Just added a product, want to verify it was added

**Note**: The `addCorpProduct` API adds inventory to a store, not a new product to the master catalog. To search for existing products, use the search box.

## Technical Details

### API Request
Every search sends:
```javascript
GET https://api.getbevvi.com/api/corpproducts?filter={...}&t=1234567890

Filter:
- where.client: "airculinaire"
- where.isActive: true
- where.or: [name LIKE term, upc LIKE term]
- fields: {name, upc, id}
- limit: 100

Headers:
- Cache-Control: no-cache, no-store, must-revalidate
- Pragma: no-cache
```

### Cache Busting Mechanisms
1. **Timestamp Parameter**: `t=${Date.now()}` - ensures unique URL
2. **No-Cache Headers**: Prevents browser/proxy caching
3. **No Client Storage**: Search results not saved to sessionStorage

### Data Freshness Guarantee
- ✅ Every search = Fresh API call
- ✅ No stale client-side cache
- ✅ Timestamp prevents server-side cache hits
- ✅ Headers prevent proxy caching

## UI Features for Updates

### 1. **Refresh Search Button**
- Appears next to "Product *" label when searching
- Manually triggers fresh API search
- Useful after known masterlist updates

### 2. **Success Banner**
After adding a product, shows:
```
Product Updates
Every search queries the API in real-time, so product 
masterlist updates are always reflected.

If you don't see an update, click the "Refresh Search" 
button or re-type your search.
```

### 3. **Console Logging**
Check browser console for search details:
```
🔍 Search for "budweiser" found 45 results
```

## Best Practices

### For Users
1. **After Masterlist Update**: Re-type search or click "Refresh Search"
2. **Verify Updates**: Use console logs to see result counts
3. **Clear Results**: Change search term to clear old results

### For Developers
1. Cache-busting is automatic (no action needed)
2. Check Network tab in DevTools to verify fresh requests
3. Each search has unique timestamp in URL

## Troubleshooting

### Issue: Not Seeing Updated Products
**Possible Causes**:
1. API hasn't synced the update yet
2. Product not matching search term
3. Product marked as inactive

**Solutions**:
1. Wait a few seconds and click "Refresh Search"
2. Try broader search term
3. Check if product is active in Bevvi

### Issue: Slow Search Results
**Possible Causes**:
1. Network latency
2. API server load
3. Very broad search term

**Solutions**:
1. Check internet connection
2. Use more specific search terms (4+ characters)
3. Limit results by being more specific

### Issue: Duplicate Results
**Possible Causes**:
1. Multiple products with same name/UPC
2. Database has duplicates

**Solutions**:
1. This is expected if database has duplicates
2. Check UPC to differentiate
3. Contact Bevvi to clean duplicates

## Comparison: Before vs After

### Before v1.0.2
- ❌ Loaded all products once on page load
- ❌ Client-side filtering of cached data
- ❌ Updates required page refresh or reload
- ❌ Stale data possible

### After v1.0.2
- ✅ Searches API in real-time
- ✅ No client-side product cache
- ✅ Always fresh data from API
- ✅ Automatic cache-busting
- ✅ Manual refresh option available

## API Response Times

| Search Term | Results | Response Time |
|-------------|---------|---------------|
| "bud" | ~70 | <1 second |
| "patron" | ~10 | <0.5 seconds |
| "coors light" | ~15 | <0.5 seconds |
| "wine" | ~100 | ~1 second |

## Notes

- **Real-time**: Every search is a fresh API call
- **No Staleness**: Data is never cached on client
- **Performance**: Still fast due to optimized queries
- **Reliability**: Cache-busting ensures fresh data
- **User Control**: Manual refresh option available

## Support

If you're still not seeing updated products after:
1. Clicking "Refresh Search"
2. Re-typing your search
3. Waiting 5-10 seconds

Then the issue is likely:
- API-side caching (contact Bevvi)
- Database sync delay (wait a minute and retry)
- Product not actually in the masterlist (verify in Bevvi admin)

