export function deviceFromUserAgent(ua: string | null): string {
  if (!ua) return "unknown"
  if (/bot|crawl|spider|slurp|curl|wget|python-requests|httpclient|node-fetch|axios/i.test(ua)) return "bot"
  if (/ipad|tablet|kindle|silk|playbook/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua))) return "tablet"
  if (/mobi|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua)) return "mobile"
  return "desktop"
}
