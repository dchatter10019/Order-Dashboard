import React, { useState, useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import Login from './components/Login'
import MainDashboard from './components/MainDashboard'
import OrderDetailsPage from './components/OrderDetailsPage'
import AppFooter from './components/AppFooter'
import './App.css'

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // Check if user is already authenticated
    const token = localStorage.getItem('bevvi_token')
    if (token) {
      setIsAuthenticated(true)
    }
    setIsLoading(false)
  }, [])

  const handleLogin = (token) => {
    localStorage.setItem('bevvi_token', token)
    setIsAuthenticated(true)
  }

  const handleLogout = () => {
    localStorage.removeItem('bevvi_token')
    setIsAuthenticated(false)
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bevvi-primary-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-bevvi-primary-600 mx-auto mb-4"></div>
          <p className="text-bevvi-primary-600">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <Router>
      <div className="App min-h-screen bevvi-page-bottom-padding">
        <Routes>
          <Route 
            path="/login" 
            element={
              isAuthenticated ? 
              <Navigate to="/dashboard" replace /> : 
              <Login onLogin={handleLogin} />
            } 
          />
          <Route 
            path="/dashboard" 
            element={
              isAuthenticated ? 
              <MainDashboard onLogout={handleLogout} /> : 
              <Navigate to="/login" replace />
            } 
          />
          <Route
            path="/orders/:orderNumber"
            element={
              isAuthenticated ?
              <OrderDetailsPage /> :
              <Navigate to="/login" replace />
            }
          />
          <Route 
            path="/" 
            element={<Navigate to={isAuthenticated ? "/dashboard" : "/login"} replace />} 
          />
        </Routes>
        <AppFooter />
      </div>
    </Router>
  )
}

export default App
