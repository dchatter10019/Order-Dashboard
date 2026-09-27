export function createAIAssistantInitialState() {
  const today = new Date()
  const todayString =
    today.getFullYear() +
    '-' +
    String(today.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(today.getDate()).padStart(2, '0')

  return {
    orders: [],
    lastFetchedRange: null,
    dateRange: {
      startDate: todayString,
      endDate: todayString
    },
    messages: [
      {
        type: 'assistant',
        content:
          "Hi! I'm your Bevvi AI assistant. Ask me about orders by date, status, customer, or revenue — I'll help you find answers fast."
      }
    ]
  }
}
