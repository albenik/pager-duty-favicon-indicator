import {DEFAULTS, LABELS, normalizeSettings, requireScope} from './lib/settings.js';
import {PagerDutyClient} from './lib/api.js';
import {summarize} from './lib/incidents.js';

const ALARM = 'signal-poll';
const initialized = Promise.all([
  chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'}),
  chrome.storage.session.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'})
]);
let queue = Promise.resolve();
function serialize(fn) { const result = queue.then(() => initialized).then(fn); queue = result.catch(() => {}); return result; }

async function load() {
  await initialized;
  const [local, session] = await Promise.all([chrome.storage.local.get(['settings', 'savedToken']), chrome.storage.session.get(['token', 'state'])]);
  return {settings: normalizeSettings(local.settings), token: session.token || local.savedToken || '', state: session.state || {}, remembered: Boolean(local.savedToken)};
}

async function setState(state) { await chrome.storage.session.set({state}); }

function displayState(settings, state, token) {
  if (!settings.enabled) return {level: 'paused', label: LABELS.paused, count: 0};
  if (!token) return {level: 'unknown', label: LABELS.unknown, count: 0};
  if (state.error || (state.checkedAt && Date.now() - state.checkedAt > Math.max(120000, settings.pollSeconds * 2000))) {
    return {level: 'stale', label: LABELS.stale, count: 0};
  }
  return state.summary || {level: 'unknown', label: 'Waiting for first check', count: 0};
}

async function schedule(settings, hasToken) {
  if (!settings.enabled || !hasToken) { await chrome.alarms.clear(ALARM); return; }
  await chrome.alarms.create(ALARM, {periodInMinutes: settings.pollSeconds / 60});
}

async function renderForTab(tab, data) {
  const {settings, token, state} = data;
  let sameAccount = false;
  try { sameAccount = new URL(tab.url).origin === settings.accountOrigin; } catch { /* Non-web tab. */ }
  if (!sameAccount || !settings.enabled || !token || (settings.activeOnly && !tab.active)) return null;
  const summary = displayState(settings, state, token);
  return {level: summary.level, color: settings.colors[summary.level], count: summary.count, showCount: settings.showCount,
    label: `PagerDuty Signal: ${summary.label}${summary.count ? ` · ${summary.count} open incident${summary.count === 1 ? '' : 's'}` : ''}`};
}

async function updateTab(tab, data) {
  if (!tab.id) return;
  const render = await renderForTab(tab, data);
  await Promise.allSettled([
    chrome.tabs.sendMessage(tab.id, {type: 'RENDER', render}),
    chrome.action.setBadgeText({tabId: tab.id, text: render ? (render.level === 'stale' || render.level === 'unknown' ? '?' : render.count ? String(Math.min(render.count, 999)) : '') : ''}),
    chrome.action.setBadgeBackgroundColor({tabId: tab.id, color: render?.color || DEFAULTS.colors.unknown}),
    chrome.action.setTitle({tabId: tab.id, title: render?.label || 'PagerDuty Signal'})
  ]);
}

async function broadcast() {
  const data = await load();
  const tabs = await chrome.tabs.query({url: ['https://*.pagerduty.com/*']});
  await Promise.allSettled(tabs.map(tab => updateTab(tab, data)));
}

async function poll() {
  const data = await load();
  const {settings, token} = data;
  if (!settings.enabled || !token) { await broadcast(); return; }
  if (data.state.retryAt > Date.now()) { await broadcast(); return; }
  try {
    requireScope(settings);
    const client = new PagerDutyClient(token, settings.region);
    const user = await client.currentUser();
    if (settings.accountOrigin !== user.accountOrigin) throw new Error('This token belongs to a different PagerDuty account. Reconnect in settings.');
    const incidents = await client.incidents(settings, user);
    await setState({user, summary: summarize(incidents, settings), checkedAt: Date.now(), error: '', failures: 0, retryAt: 0});
  } catch (error) {
    const failures = (data.state.failures || 0) + 1;
    const backoff = Math.min(300000, settings.pollSeconds * 1000 * 2 ** Math.min(failures - 1, 4));
    // Never retain a healthy favicon after a failed or incomplete check.
    await setState({...data.state, error: error.message, attemptedAt: Date.now(), failures, retryAt: error.retryAt || Date.now() + backoff});
  }
  await broadcast();
}

async function publicState() {
  const {settings, token, state, remembered} = await load();
  return {settings, state, connected: Boolean(token), remembered, display: displayState(settings, state, token)};
}

const isExtensionPage = sender => sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL(''));

async function handle(message, sender) {
  if (message?.type === 'TAB_STATUS' && sender.tab && sender.frameId === 0) {
    const data = await load();
    // Only the authenticated sender tab receives a presentation-only payload.
    await updateTab(sender.tab, data);
    return {ok: true, render: await renderForTab(sender.tab, data)};
  }
  if (!isExtensionPage(sender)) return {ok: false, error: 'This operation is only available in the extension settings.'};
  switch (message?.type) {
    case 'GET_STATE': return {ok: true, ...await publicState()};
    case 'CONNECT': return serialize(async () => {
      const {settings: previous} = await load();
      const settings = normalizeSettings({...previous, region: message.region, accountOrigin: message.accountOrigin});
      const token = String(message.token || '').trim();
      if (!token || token.length > 1024 || /[\s\x00-\x1f\x7f]/.test(token)) throw new Error('Enter a valid personal user API token.');
      const user = await new PagerDutyClient(token, settings.region).currentUser();
      if (settings.accountOrigin && settings.accountOrigin !== user.accountOrigin) throw new Error('The token belongs to a different account than the URL you entered.');
      settings.accountOrigin = user.accountOrigin;
      await chrome.storage.local.set({settings});
      if (message.remember === true) await chrome.storage.local.set({savedToken: token});
      else await chrome.storage.local.remove('savedToken');
      await chrome.storage.session.set({token, state: {user}});
      await schedule(settings, true);
      await poll();
      return {ok: true, ...await publicState()};
    });
    case 'SAVE_SETTINGS': return serialize(async () => {
      const data = await load();
      const settings = normalizeSettings({...message.settings, region: data.settings.region, accountOrigin: data.settings.accountOrigin});
      requireScope(settings);
      await chrome.storage.local.set({settings});
      // A result from the previous scope must not be shown as a result from the new scope.
      await setState({user: data.state.user, retryAt: data.state.retryAt || 0});
      await broadcast();
      await schedule(settings, Boolean(data.token));
      await poll();
      return {ok: true, ...await publicState()};
    });
    case 'REFRESH': return serialize(async () => { await poll(); return {ok: true, ...await publicState()}; });
    case 'DISCONNECT': return serialize(async () => {
      await chrome.storage.local.remove('savedToken');
      await chrome.storage.session.remove(['token', 'state']);
      await chrome.alarms.clear(ALARM);
      await broadcast();
      return {ok: true, ...await publicState()};
    });
    default: return {ok: false, error: 'Unknown request.'};
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  handle(message, sender).then(respond).catch(error => respond({ok: false, error: error.message || 'The operation could not be completed.'}));
  return true;
});
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) serialize(poll).catch(() => {}); });
chrome.runtime.onInstalled.addListener(() => serialize(async () => { const data = await load(); await schedule(data.settings, Boolean(data.token)); await poll(); }).catch(() => {}));
chrome.runtime.onStartup.addListener(() => serialize(async () => { const data = await load(); await schedule(data.settings, Boolean(data.token)); await poll(); }).catch(() => {}));
chrome.tabs.onActivated.addListener(async () => { await broadcast().catch(() => {}); });
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status === 'complete' || change.url) load().then(data => updateTab(tab, data)).catch(() => {});
});
