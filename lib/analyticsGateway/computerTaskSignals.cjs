function mapInteractiveEventFromText(text, structured) {
  const blob = `${text || ''}\n${JSON.stringify(structured || {})}`.toLowerCase()
  if (blob.includes('insufficient_credits')) {
    return { code: 'insufficient_credits', message: 'Perplexity credits exhausted' }
  }
  if (blob.includes('auth_required') || blob.includes('auth required')) {
    return { code: 'needs_auth', message: 'Computer requires administrator auth checkpoint' }
  }
  if (blob.includes('confirm_action') || blob.includes('ask_user_question')) {
    return { code: 'needs_input', message: 'Computer requires administrator confirmation — not auto-approved' }
  }
  if (blob.includes('"event":"timeout"') || blob.includes('timeout')) {
    return { code: 'submission_uncertain', message: 'Computer task timeout — reconcile before retry' }
  }
  return null
}

module.exports = {
  mapInteractiveEventFromText
}
