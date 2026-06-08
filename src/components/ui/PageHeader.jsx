import React from 'react'

const PageHeader = ({ icon: Icon, title, description, children }) => (
  <div className="bevvi-page-header">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          {Icon && (
            <span className="bevvi-page-header-icon" aria-hidden>
              <Icon className="h-5 w-5" />
            </span>
          )}
          <h2 className="bevvi-page-title">{title}</h2>
        </div>
        {description && <p className="bevvi-page-description mt-2 max-w-2xl">{description}</p>}
      </div>
      {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
    </div>
  </div>
)

export default PageHeader
