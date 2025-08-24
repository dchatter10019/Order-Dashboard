import React from 'react'

const Logo = ({ size = 'default', className = '' }) => {
  const sizeClasses = {
    small: 'h-8 w-24',
    default: 'h-12 w-32',
    large: 'h-16 w-40'
  }

  return (
    <div className={`${sizeClasses[size]} ${className}`}>
      <svg
        viewBox="0 0 120 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full"
      >
        {/* Red background */}
        <rect width="120" height="48" rx="8" fill="#DC2626" />
        
        {/* Bevvi text */}
        <text
          x="60"
          y="32"
          textAnchor="middle"
          fill="white"
          fontSize="24"
          fontWeight="600"
          fontFamily="Inter, system-ui, sans-serif"
          letterSpacing="0.5"
        >
          bevvi
        </text>
        
        {/* Wave-like lines in the 'b' loop */}
        <path
          d="M 18 20 Q 20 18 22 20 Q 24 22 22 24 Q 20 26 18 24 Q 16 22 18 20"
          fill="white"
          opacity="0.8"
        />
        <path
          d="M 20 18 Q 22 16 24 18 Q 26 20 24 22 Q 22 24 20 22 Q 18 20 20 18"
          fill="white"
          opacity="0.6"
        />
        <path
          d="M 22 16 Q 24 14 26 16 Q 28 18 26 20 Q 24 22 22 20 Q 20 18 22 16"
          fill="white"
          opacity="0.4"
        />
        
        {/* Dot above 'i' */}
        <circle cx="108" cy="16" r="2" fill="white" />
      </svg>
    </div>
  )
}

export default Logo
