import {drawFavicon} from './lib/favicon.js';
import {scopeLabel} from './lib/settings.js';
import {$, send, checkedLabel, busy, feedback} from './lib/ui.js';
let current;
function render(data) {
  current = data;
  const {settings, state, display, connected} = data;
  drawFavicon($('status-icon'), {...display, color: settings.colors[display.level], showCount: settings.showCount});
  $('status-title').textContent = display.label;
  const healthy = connected && !['unknown', 'stale', 'paused'].includes(display.level);
  $('status-description').textContent = !connected ? 'Connect your PagerDuty account to start monitoring.' : display.level === 'paused' ? 'Favicon updates are paused. Your original icon is restored.' : display.level === 'stale' ? 'Waiting for a fresh, complete check. Your previous result may be out of date.' : display.level === 'unknown' ? 'Waiting for the first successful check.' : display.count ? `${display.count} open incident${display.count === 1 ? '' : 's'} in your area of responsibility.` : 'No open incidents in your area of responsibility.';
  $('counts').classList.toggle('hidden', !healthy);
  $('triggered-count').textContent = healthy ? state.summary.triggered : '—'; $('ack-count').textContent = healthy ? state.summary.acknowledged : '—';
  $('scope-label').textContent = scopeLabel(settings); $('tracked-user').textContent = state.user?.name || '—';
  $('refresh-label').textContent = settings.pollSeconds === 30 ? 'Every 30 seconds' : `Every ${settings.pollSeconds / 60} minute${settings.pollSeconds === 60 ? '' : 's'}`;
  $('checked-at').textContent = checkedLabel(state.checkedAt);
  feedback('popup-error', state.error || (state.retryAt > Date.now() ? 'Waiting for the next retry.' : ''), true);
  document.querySelector('.popup-actions').classList.toggle('hidden', !connected);
  $('setup').classList.toggle('hidden', connected);
  $('pause').classList.toggle('hidden', !connected);
  $('pause').textContent = settings.enabled ? 'Pause' : 'Resume';
  $('refresh').disabled = !settings.enabled;
  $('popup-footer-text').textContent = connected ? (settings.enabled ? 'Monitoring your PagerDuty account' : 'Monitoring paused') : 'Private. Local. Yours.';
}
const openSettings = () => chrome.runtime.openOptionsPage();
$('settings').addEventListener('click', openSettings); $('setup').addEventListener('click', openSettings);
$('refresh').addEventListener('click', async () => {
  try { await busy($('refresh'), async () => render(await send({type: 'REFRESH'})), 'Checking…'); }
  catch (error) { feedback('popup-error', error.message, true); }
});
$('pause').addEventListener('click', async () => {
  try { const data = await busy($('pause'), () => send({type: 'SAVE_SETTINGS', settings: {...current.settings, enabled: !current.settings.enabled}})); render(data); }
  catch (error) { feedback('popup-error', error.message, true); }
});
$('open-pagerduty').addEventListener('click', async () => {
  const url = `${current.settings.accountOrigin}/incidents`;
  const tabs = await chrome.tabs.query({url: `${current.settings.accountOrigin}/*`});
  if (tabs.length) { await chrome.tabs.update(tabs[0].id, {active: true}); await chrome.windows.update(tabs[0].windowId, {focused: true}); }
  else await chrome.tabs.create({url});
  window.close();
});
try { render(await send({type: 'GET_STATE'})); } catch (error) { feedback('popup-error', error.message, true); }
setInterval(async () => { try { render(await send({type: 'GET_STATE'})); } catch { /* Popup closes when the extension reloads. */ } }, 3000);
