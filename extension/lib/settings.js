export const LEVELS = ['critical', 'high', 'medium', 'low'];
export const LABELS = {critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', clear: 'All clear', unknown: 'Not connected', stale: 'Status unavailable', paused: 'Monitoring paused'};
export const DEFAULTS = Object.freeze({
  enabled: true,
  region: 'us',
  accountOrigin: '',
  scope: 'assigned',
  teamIds: [],
  serviceIds: [],
  includeAcknowledged: true,
  pollSeconds: 60,
  activeOnly: false,
  showCount: true,
  severitySource: 'priority',
  priorityRules: {critical: ['P1', 'SEV1'], high: ['P2', 'SEV2'], medium: ['P3', 'SEV3'], low: ['P4', 'P5', 'SEV4', 'SEV5']},
  colors: {clear: '#16865f', critical: '#dc3454', high: '#e7792b', medium: '#b88b0c', low: '#4381d2', unknown: '#7c8799', stale: '#7c8799', paused: '#7c8799'}
});

export function isAccountOrigin(value) {
  try {
    const u = new URL(value);
    const parts = u.hostname.split('.');
    const reserved = ['api', 'www', 'support', 'developer', 'docs', 'events', 'identity', 'status', 'app', 'accounts'];
    const regional = parts.length === 4 && parts[1] === 'eu';
    return u.protocol === 'https:' && !u.port && !u.username && !u.password &&
      u.origin === value && (parts.length === 3 || regional) &&
      parts.slice(-2).join('.') === 'pagerduty.com' && /^[a-z0-9][a-z0-9-]*$/.test(parts[0]) && !reserved.includes(parts[0]);
  } catch { return false; }
}

export function normalizeOrigin(value) {
  if (!value?.trim()) return '';
  try {
    const url = new URL(value.trim());
    if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error();
    if (isAccountOrigin(url.origin)) return url.origin;
  } catch { /* Report a useful field error below. */ }
  throw new Error('Enter your PagerDuty account URL, such as https://acme.pagerduty.com.');
}

export function parseIds(value) {
  const ids = Array.isArray(value) ? value : String(value || '').split(/[\s,]+/);
  return [...new Set(ids.map(x => String(x).trim()).filter(Boolean))];
}

export function normalizeSettings(raw = {}) {
  const s = {...structuredClone(DEFAULTS), ...raw};
  s.colors = {...DEFAULTS.colors, ...raw.colors};
  s.priorityRules = {...structuredClone(DEFAULTS.priorityRules), ...raw.priorityRules};
  for (const key of ['enabled', 'includeAcknowledged', 'activeOnly', 'showCount']) {
    if (typeof s[key] !== 'boolean') throw new Error(`Invalid value for ${key}.`);
  }
  if (!['us', 'eu'].includes(s.region)) throw new Error('Choose a valid data region.');
  if (!['assigned', 'my-teams', 'teams', 'services'].includes(s.scope)) throw new Error('Choose an incident scope.');
  if (![30, 60, 120, 300].includes(Number(s.pollSeconds))) throw new Error('Choose a refresh interval.');
  s.pollSeconds = Number(s.pollSeconds);
  if (!['priority', 'urgency'].includes(s.severitySource)) throw new Error('Choose a severity source.');
  s.accountOrigin = normalizeOrigin(s.accountOrigin);
  for (const key of ['teamIds', 'serviceIds']) {
    s[key] = parseIds(s[key]);
    if (s[key].length > 100 || s[key].some(id => !/^[A-Z0-9]{5,32}$/.test(id))) throw new Error('Use comma-separated PagerDuty resource IDs (for example PABC123).');
  }
  const seen = new Set();
  for (const level of LEVELS) {
    const value = s.priorityRules[level];
    s.priorityRules[level] = (Array.isArray(value) ? value : String(value).split(',')).map(x => String(x).trim().toUpperCase()).filter(Boolean);
    for (const name of s.priorityRules[level]) {
      if (name.length > 80 || seen.has(name)) throw new Error('Each priority name must appear in only one severity level.');
      seen.add(name);
    }
  }
  for (const key of Object.keys(DEFAULTS.colors)) {
    if (!/^#[0-9a-f]{6}$/i.test(s.colors[key])) throw new Error('Choose valid favicon colors.');
  }
  // Persist only known, validated fields. Tokens never belong in settings.
  return Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, s[key]]));
}

export function requireScope(s) {
  if (s.scope === 'teams' && !s.teamIds.length) throw new Error('Add at least one team ID for the selected-teams scope.');
  if (s.scope === 'services' && !s.serviceIds.length) throw new Error('Add at least one service ID for the selected-services scope.');
}

export function scopeLabel(s) {
  return {assigned: 'Assigned to me', 'my-teams': 'My teams', teams: 'Selected teams', services: 'Selected services'}[s.scope];
}
