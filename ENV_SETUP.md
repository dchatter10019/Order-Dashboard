# Environment Variables Setup Guide

## ✅ Required Environment Variables

### 1. **ASANA_ACCESS_TOKEN** ✅ (Already Set)
```env
ASANA_ACCESS_TOKEN=2/568120696269174/1212643658293191:dcbc9bc31c12d69e734c2120053ebea3
```
- **Status**: ✅ You've already set this
- **Purpose**: Authenticates with Asana API for order notes integration
- **Required for**: Order notes feature (viewing/saving notes in Asana)

### 2. **ASANA_WORKSPACE_GID** ⚠️ (Needs to be set)
```env
ASANA_WORKSPACE_GID=your-workspace-gid-here
```
- **Status**: ⚠️ **YOU NEED TO SET THIS**
- **Purpose**: Specifies which Asana workspace to use
- **How to get it**: Run `node get-asana-workspace.js` to find your workspace GID
- **Required for**: Order notes feature to work

---

## 🔧 Optional Environment Variables

### 3. **ASANA_PROJECT_GID** (Optional)
```env
ASANA_PROJECT_GID=your-project-gid-here
```
- **Status**: Optional
- **Purpose**: If set, all Asana tasks will be created in this specific project
- **How to get it**: Run `node get-asana-workspace.js` after setting workspace GID - it will show available projects
- **If not set**: Tasks will be created in your workspace but not assigned to any project

### 4. **OPENAI_API_KEY** (Optional)
```env
OPENAI_API_KEY=sk-your-openai-api-key-here
```
- **Status**: Optional
- **Purpose**: Powers the AI Assistant feature (natural language queries)
- **Required for**: AI Assistant tab functionality
- **If not set**: AI Assistant will show an error when trying to parse prompts
- **How to get it**: 
  1. Go to https://platform.openai.com/api-keys
  2. Create a new API key
  3. Copy and paste it here

### 5. **PORT** (Has Default)
```env
PORT=3001
```
- **Status**: Optional (defaults to 3001)
- **Purpose**: Sets the server port
- **Default**: 3001
- **Only change if**: Port 3001 is already in use

### 6. **NODE_ENV** (Optional)
```env
NODE_ENV=development
```
- **Status**: Optional
- **Purpose**: Sets the environment (development/production)
- **Default**: Not set (development mode)

---

## ❌ Not Currently Used (Can be ignored)

These are in `env.example` but not actually used in the code:

- `BEVVI_API_BASE_URL` - API URLs are hardcoded in server.js
- `BEVVI_API_TIMEOUT` - Timeouts are hardcoded
- `SESSION_SECRET` - Not using sessions
- `CORS_ORIGIN` - CORS origins are hardcoded
- `FACEBOOK_API_IDENTIFIER` - Not integrated yet

---

## 📋 Quick Setup Checklist

### Minimum Setup (Order Tracking Only)
- ✅ `ASANA_ACCESS_TOKEN` - Already set
- ⚠️ `ASANA_WORKSPACE_GID` - **YOU NEED TO SET THIS**

### Full Setup (All Features)
- ✅ `ASANA_ACCESS_TOKEN` - Already set
- ⚠️ `ASANA_WORKSPACE_GID` - **YOU NEED TO SET THIS**
- ⬜ `ASANA_PROJECT_GID` - Optional (recommended)
- ⬜ `OPENAI_API_KEY` - Optional (for AI Assistant)

---

## 🚀 Setup Steps

1. **Get your Workspace GID**:
   ```bash
   node get-asana-workspace.js
   ```
   This will show you your workspace GID(s)

2. **Create/Edit your `.env` file**:
   ```bash
   cp env.example .env
   nano .env  # or use your preferred editor
   ```

3. **Add the required variables**:
   ```env
   ASANA_ACCESS_TOKEN=2/568120696269174/1212643658293191:dcbc9bc31c12d69e734c2120053ebea3
   ASANA_WORKSPACE_GID=<gid-from-step-1>
   ```

4. **Optional: Add project GID** (run the script again after setting workspace):
   ```env
   ASANA_PROJECT_GID=<project-gid>
   ```

5. **Optional: Add OpenAI key** (if you want AI Assistant):
   ```env
   OPENAI_API_KEY=sk-your-key-here
   ```

6. **Restart your server**:
   ```bash
   npm start
   ```

---

## ✅ Verification

After setting up, test your configuration:

1. **Test Asana connection**: Open an order modal and check if notes load
2. **Test OpenAI** (if set): Try asking the AI Assistant a question
3. **Check server logs**: Look for any configuration errors

---

## 🆘 Troubleshooting

### "Asana not configured" error
- Make sure `ASANA_ACCESS_TOKEN` is set correctly
- Make sure `ASANA_WORKSPACE_GID` is set (not the placeholder text)

### "OpenAI API key not configured" error
- This is normal if you haven't set `OPENAI_API_KEY`
- Only affects AI Assistant feature
- Order tracking will work fine without it

### Can't find workspace GID
- Run `node get-asana-workspace.js` with your access token
- Make sure your token has workspace access permissions

