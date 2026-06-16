import React from 'react'
import { Bell, X } from 'lucide-react'
import { useOrderNotifications } from '../context/OrderNotificationsContext'

const BrowserNotificationPrompt = () => {
  const {
    browserPermission,
    showBrowserPrompt,
    requestBrowserPermission,
    dismissBrowserPrompt
  } = useOrderNotifications()

  if (!showBrowserPrompt) {
    return null
  }

  const isDenied = browserPermission === 'denied'

  return (
    <div
      className="browser-notification-prompt relative"
      role="dialog"
      aria-labelledby="browser-notification-prompt-title"
      aria-describedby="browser-notification-prompt-description"
    >
      <div className="flex items-start gap-3">
        <span className="browser-notification-prompt-icon" aria-hidden="true">
          <Bell className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p id="browser-notification-prompt-title" className="browser-notification-prompt-title">
            Turn on browser notifications
          </p>
          <p id="browser-notification-prompt-description" className="browser-notification-prompt-body">
            {isDenied ? (
              <>
                Browser notifications are blocked for this site. Enable them in your browser&apos;s
                site settings to get new order alerts when this tab is in the background.
              </>
            ) : (
              <>
                Get new order alerts even when this tab is in the background. Allow notifications
                when your browser asks.
              </>
            )}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {!isDenied && (
              <button
                type="button"
                className="browser-notification-prompt-primary"
                onClick={requestBrowserPermission}
              >
                Enable notifications
              </button>
            )}
            <button
              type="button"
              className="browser-notification-prompt-secondary"
              onClick={dismissBrowserPrompt}
            >
              {isDenied ? 'Dismiss' : 'Not now'}
            </button>
          </div>
        </div>
        <button
          type="button"
          className="browser-notification-prompt-close"
          onClick={dismissBrowserPrompt}
          aria-label="Dismiss notification prompt"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

export default BrowserNotificationPrompt
