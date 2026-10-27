import {DEFAULTS, LABELS, LEVELS, normalizeSettings, requireScope, scopeLabel} from './lib/settings.js';
import {drawFavicon} from './lib/favicon.js';
import {$, send, feedback, checkedLabel, busy} from './lib/ui.js';

let current;
const colorLevels = ['clear', ...LEVELS];
for (const level of colorLevels) {
  const row = document.createElement('label'); row.className = 'color-row';
  const input = document.createElement('input'); input.type = 'color'; input.id = `color-${level}`; input.setAttribute('aria-label', `${LABELS[level]} favicon color`);
  const label = document.createElement('span'); label.textContent = LABELS[level];
  const hex = document.createElement('span'); hex.className = 'color-hex'; hex.id = `hex-${level}`;
  const hint = document.createElement('span'); hint.className = 'color-hint'; hint.textContent = level === 'clear' ? 'No open incidents' : {critical: 'P1 / SEV1', high: 'P2 / SEV2', medium: 'P3 / SEV3', low: 'P4–P5 / SEV4–SEV5'}[level];
  row.append(input, label, hint, hex); $('color-list').append(row);
}
for (const level of LEVELS) {
  const label = document.createElement('label'); label.textContent = LABELS[level];
  const input = document.createElement('input'); input.id = `rule-${level}`; input.autocomplete = 'off'; input.spellcheck = false;
  label.append(input); $('priority-rules').append(label);
}

function readForm() {
  const s = {...current.settings,
    enabled: $('enabled').checked, scope: $('scope').value, teamIds: $('team-ids').value, serviceIds: $('service-ids').value,
    pollSeconds: Number($('poll-seconds').value), severitySource: $('severity-source').value,
    includeAcknowledged: $('include-acknowledged').checked, showCount: $('show-count').checked,
    activeOnly: document.querySelector('input[name="tabs"]:checked').value === 'active',
    colors: {...current.settings.colors}, priorityRules: {}};
  for (const level of colorLevels) s.colors[level] = $(`color-${level}`).value;
  for (const level of LEVELS) s.priorityRules[level] = $(`rule-${level}`).value;
  return normalizeSettings(s);
}

function fillForm(settings) {
  for (const [id, key] of [['enabled', 'enabled'], ['include-acknowledged', 'includeAcknowledged'], ['show-count', 'showCount']]) $(id).checked = settings[key];
  for (const [id, key] of [['scope', 'scope'], ['poll-seconds', 'pollSeconds'], ['severity-source', 'severitySource']]) $(id).value = settings[key];
  $('team-ids').value = settings.teamIds.join(', '); $('service-ids').value = settings.serviceIds.join(', ');
  document.querySelector(`input[name="tabs"][value="${settings.activeOnly ? 'active' : 'all'}"]`).checked = true;
  for (const level of colorLevels) $(`color-${level}`).value = settings.colors[level];
  for (const level of LEVELS) $(`rule-${level}`).value = settings.priorityRules[level].join(', ');
  updatePreview(); updateScope();
}

function updateScope() {
  $('teams-field').classList.toggle('hidden', $('scope').value !== 'teams');
  $('services-field').classList.toggle('hidden', $('scope').value !== 'services');
  $('team-ids').required = $('scope').value === 'teams'; $('service-ids').required = $('scope').value === 'services';
  const teamCount = current?.state.user?.teams?.length || 0;
  $('scope-help').textContent = {
    assigned: 'Uses the current user returned by your personal API token.',
    'my-teams': current?.connected ? `Tracks all incidents related to your ${teamCount} team${teamCount === 1 ? '' : 's'}. No teams means no matching incidents.` : 'Uses team memberships returned by your personal API token.',
    teams: 'Tracks incidents related to any of the team IDs below.', services: 'Tracks incidents related to any of the service IDs below.'
  }[$('scope').value];
}

function updatePreview() {
  const level = $('preview-level').value;
  const color = colorLevels.includes(level) ? $(`color-${level}`).value : DEFAULTS.colors.stale;
  const data = {level, color, count: ['clear', 'stale'].includes(level) ? 0 : 3, showCount: $('show-count').checked};
  drawFavicon($('tab-preview'), data); drawFavicon($('large-preview'), data);
  $('preview-name').textContent = LABELS[level];
  $('preview-description').textContent = level === 'clear' ? 'Nothing open in your chosen scope.' : level === 'stale' ? 'A failed check never looks all clear.' : 'Highest severity, always visible.';
  for (const key of colorLevels) $(`hex-${key}`).textContent = $(`color-${key}`).value.toUpperCase();
  for (const key of LEVELS) {
    const names = $(`rule-${key}`).value;
    document.querySelector(`#color-${key}`).parentElement.querySelector('.color-hint').textContent = $('severity-source').value === 'urgency' ? (key === 'high' ? 'High urgency' : key === 'low' ? 'Low urgency' : 'Priority mode only') : names.replaceAll(',', ' /') || 'No mapped priorities';
  }
}

function renderStatus(data) {
  current = data;
  const {connected, state, display, settings} = data;
  $('connection-pill').textContent = connected ? 'Connected' : 'Not connected';
  $('connection-pill').classList.toggle('connected', connected);
  $('identity').classList.toggle('hidden', !connected || !state.user);
  if (state.user) {
    $('user-name').textContent = state.user.name; $('user-email').textContent = state.user.email;
    $('user-account').textContent = state.user.accountOrigin;
    $('avatar').textContent = state.user.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  }
  $('live-status').textContent = display.label;
  $('live-dot').style.backgroundColor = settings.colors[display.level];
  $('live-description').textContent = !connected ? 'Connect your account to start monitoring.' : state.error || (display.level === 'stale' ? 'The last result is out of date. Waiting for a fresh check.' : display.level === 'paused' ? 'Your original PagerDuty favicon is restored.' : `${display.count} open incident${display.count === 1 ? '' : 's'} · ${scopeLabel(settings)}`);
  $('last-checked').textContent = checkedLabel(state.checkedAt);
  $('refresh').disabled = !connected || !settings.enabled;
  updateScope();
}

$('connection-form').addEventListener('submit', async event => {
  event.preventDefault(); feedback('connection-feedback', 'Verifying your identity…');
  try {
    await busy($('connect'), async () => {
      const data = await send({type: 'CONNECT', region: $('region').value, accountOrigin: $('account-origin').value, token: $('token').value, remember: $('remember').checked});
      $('token').value = ''; $('account-origin').value = data.settings.accountOrigin;
      renderStatus(data); feedback('connection-feedback', data.state.error ? `Connected. ${data.state.error}` : 'Connected. Your PagerDuty account is ready.', Boolean(data.state.error));
    }, 'Connecting…');
  } catch (error) { feedback('connection-feedback', error.message, true); }
});
$('disconnect').addEventListener('click', async () => {
  try {
    await busy($('disconnect'), async () => { const data = await send({type: 'DISCONNECT'}); renderStatus(data); $('token').value = ''; feedback('connection-feedback', 'Disconnected. The token has been removed from Chrome.'); });
  } catch (error) { feedback('connection-feedback', error.message, true); }
});
$('settings-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const settings = readForm(); requireScope(settings);
    feedback('settings-feedback', 'Saving preferences…');
    await busy($('save'), async () => { const data = await send({type: 'SAVE_SETTINGS', settings}); renderStatus(data); fillForm(data.settings); $('dirty-indicator').textContent = ''; feedback('settings-feedback', data.state.error ? `Saved. ${data.state.error}` : 'Preferences saved.', Boolean(data.state.error)); }, 'Saving…');
  } catch (error) { feedback('settings-feedback', error.message, true); }
});
$('reset').addEventListener('click', () => { fillForm(structuredClone(DEFAULTS)); $('dirty-indicator').textContent = 'Unsaved changes'; feedback('settings-feedback', 'Default preferences restored in this form. Save to apply.'); });
$('settings-form').addEventListener('input', () => { $('dirty-indicator').textContent = 'Unsaved changes'; updateScope(); updatePreview(); });
$('preview-level').addEventListener('change', updatePreview);
$('refresh').addEventListener('click', async () => {
  try { await busy($('refresh'), async () => { renderStatus(await send({type: 'REFRESH'})); }, 'Checking…'); }
  catch (error) { feedback('settings-feedback', error.message, true); }
});

try {
  const data = await send({type: 'GET_STATE'});
  current = data; fillForm(data.settings); renderStatus(data);
  $('region').value = data.settings.region; $('account-origin').value = data.settings.accountOrigin; $('remember').checked = data.remembered;
} catch (error) { feedback('connection-feedback', error.message, true); }
setInterval(async () => { try { renderStatus(await send({type: 'GET_STATE'})); } catch { /* The page can be refreshed after an extension update. */ } }, 5000);
