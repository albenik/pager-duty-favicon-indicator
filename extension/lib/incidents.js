import {LEVELS, LABELS} from './settings.js';

export function severityOf(incident, settings) {
  if (settings.severitySource === 'priority') {
    const name = String(incident.priority?.name || incident.priority?.summary || '').trim().toUpperCase();
    const match = LEVELS.find(level => settings.priorityRules[level].includes(name));
    if (match) return match;
  }
  // Urgency is the documented incident-level fallback; alert severity is a different concept.
  return incident.urgency === 'low' ? 'low' : 'high';
}

export function summarize(incidents, settings) {
  const unique = [...new Map(incidents.map(i => [i.id, i])).values()];
  const open = unique.filter(i => i.status === 'triggered' || (settings.includeAcknowledged && i.status === 'acknowledged'));
  const counts = Object.fromEntries(LEVELS.map(level => [level, 0]));
  let triggered = 0;
  for (const i of open) {
    counts[severityOf(i, settings)]++;
    if (i.status === 'triggered') triggered++;
  }
  const level = LEVELS.find(l => counts[l] > 0) || 'clear';
  return {level, label: LABELS[level], count: open.length, triggered, acknowledged: open.length - triggered, counts};
}

export function incidentParams(settings, user) {
  const p = new URLSearchParams({date_range: 'all', limit: '100'});
  p.append('statuses[]', 'triggered');
  if (settings.includeAcknowledged) p.append('statuses[]', 'acknowledged');
  p.append('include[]', 'priorities');
  switch (settings.scope) {
    case 'assigned': p.append('user_ids[]', user.id); break;
    case 'my-teams': {
      const ids = (user.teams || []).map(t => t.id).filter(Boolean);
      if (!ids.length) return null; // Never accidentally query every incident for a user with no teams.
      ids.forEach(id => p.append('team_ids[]', id));
      break;
    }
    case 'teams':
      if (!settings.teamIds.length) throw new Error('Select at least one team.');
      settings.teamIds.forEach(id => p.append('team_ids[]', id)); break;
    case 'services':
      if (!settings.serviceIds.length) throw new Error('Select at least one service.');
      settings.serviceIds.forEach(id => p.append('service_ids[]', id)); break;
    default: throw new Error('Invalid incident scope.');
  }
  return p;
}
