# 🚀 Quick Start Guide - Fix 403 Error

## ❌ **Problem Solved: 403 Error Fixed!**

The 403 error was caused by port conflicts and configuration issues. Here's how to get your Bevvi Order Tracking System running:

## ✅ **Solution: Use Port 3001**

The system is now configured to run on port **3001** instead of 5000 to avoid conflicts.

## 🚀 **How to Start the System**

### **Option 1: Production Mode (Recommended)**
```bash
# Build and start the production server
npm run build
npm start
```
**Access at:** http://localhost:3001

### **Option 2: Development Mode (Full Stack)**
```bash
# Start both frontend and backend simultaneously
npm run dev:full
```
**Frontend:** http://localhost:3000  
**Backend:** http://localhost:3001

### **Option 3: Separate Development Servers**
```bash
# Terminal 1 - Backend
npm run server

# Terminal 2 - Frontend  
npm run frontend
```

## 🔧 **What Was Fixed**

1. **Port Conflict**: Changed from port 5000 to 3001
2. **CORS Configuration**: Added proper CORS settings
3. **Static File Serving**: Fixed static file serving issues
4. **Error Handling**: Added better error handling and debugging

## 🌐 **Current Status**

✅ **Backend Server**: Running on http://localhost:3001  
✅ **API Endpoints**: Working correctly  
✅ **Frontend**: Built and ready to serve  
✅ **Authentication**: Ready with Bevvi_User / Bevvi_123#  

## 🧪 **Test the System**

1. **Health Check**: http://localhost:3001/api/health
2. **Orders API**: http://localhost:3001/api/orders?startDate=2025-08-14&endDate=2025-08-14
3. **Main App**: http://localhost:3001

## 🎯 **Next Steps**

1. Open http://localhost:3001 in your browser
2. Login with: `Bevvi_User` / `Bevvi_123#`
3. Start tracking your Bevvi orders!

## 🆘 **If You Still Have Issues**

1. **Check Ports**: Make sure nothing is using ports 3000 or 3001
2. **Kill Processes**: `lsof -ti:3001 | xargs kill -9`
3. **Restart**: Run `npm start` again
4. **Check Logs**: Look for any error messages in the terminal

---

**🎉 Your Bevvi Order Tracking System is now working perfectly!**
