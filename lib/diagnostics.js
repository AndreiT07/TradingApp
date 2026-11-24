// Return names/codes only. Never forward credentials or raw provider error messages.
export function missingConfiguration(env) {
  const missing = [];
  if (!env.FINNHUB_API_KEY?.trim()) missing.push('FINNHUB_API_KEY');
  if (env.DATA_PROVIDER_TERMS_ACCEPTED !== 'true') missing.push('DATA_PROVIDER_TERMS_ACCEPTED');
  return missing;
}
export function providerFailure(error) {
  if (error?.status === 401) return 'provider_auth';
  if (error?.status === 403) return 'provider_access';
  if (error?.status === 429) return 'provider_quota';
  if ([400, 404, 422].includes(error?.status)) return 'provider_request';
  if (error?.status === 402) return 'provider_billing';
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError' || error?.code === 'UND_ERR_CONNECT_TIMEOUT') return 'provider_timeout';
  return 'provider_unavailable';
}
