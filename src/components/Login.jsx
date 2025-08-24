import React, { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import Logo from './Logo'

const Login = ({ onLogin }) => {
  const [showPassword, setShowPassword] = useState(false)
  const [credentials, setCredentials] = useState({
    username: '',
    password: ''
  })
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    // Check credentials
    if (credentials.username === 'Bevvi_User' && credentials.password === 'Bevvi_123#') {
      // Simulate API call delay
      setTimeout(() => {
        onLogin('bevvi_auth_token_' + Date.now())
        setIsLoading(false)
      }, 1000)
    } else {
      setError('Invalid credentials. Please use Bevvi_User / Bevvi_123#')
      setIsLoading(false)
    }
  }

  const handleInputChange = (e) => {
    setCredentials({
      ...credentials,
      [e.target.name]: e.target.value
    })
    if (error) setError('')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-cyan-50 px-4">
      <div className="max-w-md w-full space-y-8">
        {/* Logo and Header */}
        <div className="text-center">
          <div className="mx-auto mb-6 flex justify-center">
            <Logo size="large" />
          </div>
          <h2 className="text-4xl font-bold text-gray-900 mb-3">
            Order Tracking
          </h2>
          <p className="text-gray-600 text-lg">
            Sign in to access your order management system
          </p>
        </div>

        {/* Login Form */}
        <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8">
          <form className="space-y-6" onSubmit={handleSubmit}>
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-2">
                Username
              </label>
              <input
                id="username"
                name="username"
                type="text"
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-300 transition-all duration-200 bg-gray-50"
                placeholder="Enter your username"
                value={credentials.username}
                onChange={handleInputChange}
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-300 transition-all duration-200 bg-gray-50 pr-10"
                  placeholder="Enter your password"
                  value={credentials.password}
                  onChange={handleInputChange}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 pr-3 flex items-center"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <EyeOff className="h-5 w-5 text-gray-400" />
                  ) : (
                    <Eye className="h-5 w-5 text-gray-400" />
                  )}
                </button>
              </div>
            </div>

                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <p className="text-sm text-blue-800">
            <strong>Demo Credentials:</strong><br />
            Username: <code className="bg-blue-100 px-2 py-1 rounded-lg font-mono">Bevvi_User</code><br />
            Password: <code className="bg-blue-100 px-2 py-1 rounded-lg font-mono">Bevvi_123#</code>
          </p>
        </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
            >
              {isLoading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Signing in...
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <div className="text-center text-sm text-gray-500">
          <p>© 2024 Bevvi. All rights reserved.</p>
        </div>
      </div>
    </div>
  )
}

export default Login
