# Product Management API Integration

## Summary of Changes

This document outlines the changes made to the Product Management tab to integrate with the Bevvi API instead of CSV uploads.

## Changes Made

### 1. **API Integration**
   - **Products API**: Now loads products from `https://api.getbevvi.com/api/corpproducts/searchCorpProductsByString?searchString=&client=airculinaire`
   - **Stores API**: Now loads stores from `https://api.getbevvi.com/api/corputil/getStoresAsJSON`
   - Removed CSV file upload functionality
   - Added automatic API data loading on first visit

### 2. **Company Name Fixed**
   - Company name is now hardcoded to **"airculinaire"**
   - Company field is now disabled (read-only) showing "airculinaire"
   - All product additions will automatically use "airculinaire" as the company

### 3. **Data Persistence**
   - Products and stores data are now persisted in **sessionStorage**
   - Data persists across page refreshes during the same browser session
   - Data is cleared when the browser tab/window is closed (session ends)
   - Prevents unnecessary API calls on every page navigation

### 4. **UI Updates**
   - Replaced CSV upload cards with status cards showing:
     - Products loaded from API
     - Stores loaded from API
     - Company set to "airculinaire"
   - Added "Refresh Data from API" button to manually reload data
   - Updated form to show company field as disabled with helper text
   - Removed companies preview section (no longer needed)
   - Updated grid layout from 3 columns to 2 columns for preview section

### 5. **Technical Implementation Details**

#### State Management
```javascript
// Initialize from sessionStorage
const [products, setProducts] = useState(() => {
  const saved = sessionStorage.getItem('bevvi_products')
  return saved ? JSON.parse(saved) : []
})

const [stores, setStores] = useState(() => {
  const saved = sessionStorage.getItem('bevvi_stores')
  return saved ? JSON.parse(saved) : []
})

// Company is hardcoded
const [selectedCompany, setSelectedCompany] = useState('airculinaire')
```

#### Data Loading
```javascript
// Automatically loads on first visit if no data in sessionStorage
useEffect(() => {
  const loadInitialData = async () => {
    const hasProductsInStorage = sessionStorage.getItem('bevvi_products')
    const hasStoresInStorage = sessionStorage.getItem('bevvi_stores')
    
    if (!hasProductsInStorage && !hasStoresInStorage) {
      await loadDataFromAPIs()
    }
  }
  loadInitialData()
}, [])
```

#### Data Persistence
```javascript
// Auto-save to sessionStorage when data changes
useEffect(() => {
  if (products.length > 0) {
    sessionStorage.setItem('bevvi_products', JSON.stringify(products))
  }
}, [products])

useEffect(() => {
  if (stores.length > 0) {
    sessionStorage.setItem('bevvi_stores', JSON.stringify(stores))
  }
}, [stores])
```

### 6. **User Experience Improvements**
   - Faster initial load after first visit (data cached in sessionStorage)
   - No need to upload CSV files manually
   - Automatic data loading on first use
   - Manual refresh option available via "Refresh Data from API" button
   - Loading states with spinner animations
   - Success/error messages for API calls

## API Endpoints Used

1. **Products**: `GET https://api.getbevvi.com/api/corpproducts/searchCorpProductsByString?searchString=&client=airculinaire`
   - Returns products for the airculinaire company
   - Response format: `{ results: [...] }`

2. **Stores**: `GET https://api.getbevvi.com/api/corputil/getStoresAsJSON`
   - Returns list of all stores
   - Response format: `{ results: [{ name, address, email, phoneNum }] }`

3. **Add Product**: `GET https://api.getbevvi.com/api/corpproducts/addCorpProduct?storeName={store}&upc={upc}&price={price}&inventory={quantity}&client=airculinaire`
   - Adds a product to the specified store
   - Company is automatically set to "airculinaire"

## Testing

To test the changes:
1. Navigate to the Products tab
2. Data should load automatically from the API
3. Select a product, store, enter price and quantity
4. Click "Add Product"
5. Refresh the page - data should persist
6. Close and reopen the browser - data should reload from API

## Notes

- Data is stored in **sessionStorage** (not localStorage)
- Data persists during the browser session only
- Closing the tab/browser window clears the data
- Next visit will automatically reload from API
- Company is always "airculinaire" for all operations

