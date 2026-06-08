import React from 'react'

const Logo = ({ size = 'default', onDark = false, className = '' }) => {
  const heightClasses = {
    small: 'h-7 sm:h-8',
    default: 'h-10 sm:h-11 md:h-12',
    large: 'h-14 sm:h-16 md:h-[4.25rem]'
  }

  const img = (
    <img
      src="/bevvi-wordmark.png"
      alt="Bevvi"
      className="h-full w-auto max-h-full object-contain object-left"
      decoding="async"
    />
  )

  if (onDark) {
    return (
      <div
        className={`flex shrink-0 items-center rounded-lg bg-white px-2.5 py-1.5 shadow-sm ${heightClasses[size]} ${className}`}
      >
        {img}
      </div>
    )
  }

  return (
    <div className={`flex shrink-0 items-center ${heightClasses[size]} ${className}`}>
      {img}
    </div>
  )
}

export default Logo
