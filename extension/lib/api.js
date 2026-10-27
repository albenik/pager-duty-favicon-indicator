import {isAccountOrigin} from './settings.js';
import {incidentParams} from './incidents.js';

export class ApiError extends Error {
  constructor(message, status = 0, retryAt = 0) { super(message); this.status = status; this.retryAt = retryAt; }
}

export function retryTime(value, now = Date.now()) {
  const seconds = Number(value);
  if (value && Number.isFinite(seconds)) return now + Math.max(30, seconds) * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(now + 30000, date) : now + 60000;
}

export class PagerDutyClient {
  constructor(token, region, fetcher = globalThis.fetch) {
    this.token = token;
    this.base = region === 'eu' ? 'https://api.eu.pagerduty.com' : 'https://api.pagerduty.com';
    this.fetcher = fetcher;
  }

  async get(path, params) {
    const url = new URL(path, this.base);
    if (url.origin !== this.base || !['/users/me', '/incidents'].includes(url.pathname)) throw new ApiError('Unsupported API request.');
    if (params) url.search = params.toString();
    let response;
    try {
      response = await this.fetcher(url.href, {
        method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store',
        headers: {Authorization: `Token token=${this.token}`, Accept: 'application/vnd.pagerduty+json;version=2'},
        signal: AbortSignal.timeout(15000)
      });
    } catch { throw new ApiError('Cannot reach PagerDuty. Check your connection and data region.'); }
    if (response.status === 429) throw new ApiError('PagerDuty rate limit reached. Monitoring will retry automatically.', 429, retryTime(response.headers.get('Retry-After')));
    if ([401, 403, 404].includes(response.status)) throw new ApiError('Connection rejected. Use your personal user API token and the correct data region.', response.status);
    if (!response.ok) throw new ApiError(`PagerDuty is unavailable (HTTP ${response.status}). Monitoring will retry.`, response.status);
    try { return await response.json(); } catch { throw new ApiError('PagerDuty returned an unreadable response.'); }
  }

  async currentUser() {
    const data = await this.get('/users/me', new URLSearchParams({'include[]': 'teams'}));
    const u = data.user;
    let origin;
    try { origin = new URL(u.html_url).origin; } catch { throw new ApiError('PagerDuty did not return an account URL for this user.'); }
    if (!u?.id || !isAccountOrigin(origin)) throw new ApiError('PagerDuty did not return a valid user identity.');
    return {id: u.id, name: String(u.name || u.summary || u.id), email: String(u.email || ''), accountOrigin: origin,
      teams: (Array.isArray(u.teams) ? u.teams : []).filter(t => t?.id).map(t => ({id: t.id, name: String(t.summary || t.name || t.id)}))};
  }

  async incidents(settings, user) {
    const params = incidentParams(settings, user);
    if (!params) return [];
    const incidents = [];
    // Bounded pagination prevents a malformed response from looping or claiming an incomplete result is all clear.
    for (let page = 0; page < 100; page++) {
      params.set('offset', String(page * 100));
      const data = await this.get('/incidents', params);
      if (!Array.isArray(data.incidents) || data.incidents.some(i => !i?.id || !['triggered', 'acknowledged', 'resolved'].includes(i.status))) throw new ApiError('PagerDuty returned invalid incident data.');
      incidents.push(...data.incidents);
      if (data.more === false) return incidents;
      if (data.more !== true || !data.incidents.length) throw new ApiError('PagerDuty returned incomplete pagination data.');
    }
    throw new ApiError('Too many incidents to load safely. Narrow your team or service scope.');
  }
}
