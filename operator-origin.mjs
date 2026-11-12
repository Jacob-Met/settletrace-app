// One explicitly configured HTTPS origin for a maintained private proxy.
export function operatorOriginAllowed(configured = '') {
 const value = configured.trim();
 if (value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('SETTLETRACE_ORIGIN must be an exact HTTPS origin'); }
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password)
   throw new Error('SETTLETRACE_ORIGIN must be an exact HTTPS origin');
 }
 return origin => !origin || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) || (!!value && origin === value);
}
