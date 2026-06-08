import React from 'react'
import pkg from '../../package.json'
import { BRAND } from '../constants/brand'

const AppFooter = () => (
  <footer className="bevvi-app-footer" role="contentinfo">
    <div className="h-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-3 text-xs sm:text-sm">
      <p className="text-white/90 truncate">{BRAND.footer}</p>
      <p className="text-white/70 shrink-0">
        {BRAND.copyright} · v{pkg.version}
      </p>
    </div>
  </footer>
)

export default AppFooter
