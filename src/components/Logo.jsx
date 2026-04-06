import React from 'react'

const Logo = ({ size = 'default', className = '' }) => {
  const heightClasses = {
    small: 'h-7 sm:h-8',
    default: 'h-10 sm:h-11 md:h-12',
    large: 'h-14 sm:h-16 md:h-[4.25rem]'
  }

  return (
    <div className={`flex shrink-0 items-center ${heightClasses[size]} ${className}`}>
      <img
        src="/bevvi-wordmark.png"
        alt="Bevvi"
        className="h-full w-auto max-h-full object-contain object-left"
        decoding="async"
      />
    </div>
  )
}

export default Logo
