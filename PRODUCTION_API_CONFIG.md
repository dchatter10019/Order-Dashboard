# Production API Configuration

## Problem
In production, if the frontend and backend are served from different origins (different domains, ports, or servers), relative API URLs like `/api/stores` will go to the frontend server instead of the backend, causing HTML responses instead of JSON.

## Solution
The frontend now uses an environment variable `VITE_API_BASE_URL` to configure the backend API URL in production.

## Configuration

### Option 1: Same Origin (Frontend and Backend on Same Domain)
If your frontend and backend are served from the same domain (e.g., both on `https://example.com`), you don't need to set `VITE_API_BASE_URL`. The frontend will use relative URLs.

**Example:**
- Frontend: `https://example.com`
- Backend: `https://example.com:3001` or `https://example.com/api`

### Option 2: Different Origins (Frontend and Backend on Different Domains/Ports)
If your frontend and backend are on different origins, set `VITE_API_BASE_URL` to point to your backend server.

**Example 1: Different Ports**
```bash
# .env.production
VITE_API_BASE_URL=http://localhost:3001
```

**Example 2: Different Domains**
```bash
# .env.production
VITE_API_BASE_URL=https://api.example.com
```

**Example 3: Backend on Subdomain**
```bash
# .env.production
VITE_API_BASE_URL=https://backend.example.com
```

## How to Set Environment Variables

### During Build Time
Vite environment variables must be set at build time (not runtime). They are embedded into the build.

1. Create a `.env.production` file in the project root:
```bash
VITE_API_BASE_URL=https://your-backend-url.com
```

2. Build the frontend:
```bash
npm run build
```

The environment variable will be embedded into the build.

### Using Command Line
```bash
VITE_API_BASE_URL=https://api.example.com npm run build
```

### Using .env Files
Create `.env.production` in the project root:
```
VITE_API_BASE_URL=https://api.example.com
```

Then build:
```bash
npm run build
```

## Verification

After building, check the browser console. You should see log messages like:
```
🌐 API Request: https://api.example.com/api/stores
```

If you see relative URLs like `/api/stores` in production, the environment variable wasn't set correctly.

## Troubleshooting

### API calls still going to frontend server
1. Make sure `VITE_API_BASE_URL` is set before running `npm run build`
2. Check that the environment variable name starts with `VITE_` (required by Vite)
3. Rebuild the frontend after changing the environment variable
4. Clear browser cache and hard refresh

### CORS Errors
If you set `VITE_API_BASE_URL` to a different origin, make sure your backend CORS configuration allows requests from your frontend origin.

Update `server.js` CORS configuration:
```javascript
app.use(cors({
  origin: ['https://your-frontend-domain.com', 'http://localhost:3000'],
  credentials: true
}))
```

## Development vs Production

- **Development**: Uses relative URLs (`/api/stores`) - Vite proxy handles routing to `http://localhost:3001`
- **Production**: Uses `VITE_API_BASE_URL` if set, otherwise uses relative URLs (assumes same origin)

## Files Changed

- `src/utils/api.js` - New utility for API base URL configuration
- All components updated to use `apiFetch()` instead of `fetch()`
- Components updated:
  - `src/components/Dashboard.jsx`
  - `src/components/ProductManagement.jsx`
  - `src/components/CommandInterface.jsx`
