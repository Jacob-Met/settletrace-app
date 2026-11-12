// A provider event read and a verified inbound delivery are different evidence.
export const isProviderRead = event => event?.source === 'sandbox_event_api'
  && typeof event.provider_observed_at === 'string' && !!event.provider_observed_at;
export const hasEventAuthority = event => !event?.sample
  && (event?.verified === true || isProviderRead(event));
