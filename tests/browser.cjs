/* Runs production scripts in Chromium with a Chrome API test harness and synthetic PagerDuty responses. */
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const createHarness = require('./harness.cjs');
const root = path.resolve(__dirname, '..');
const extension = path.join(root, 'extension');
const work = path.join(root, 'work');
fs.mkdirSync(work, {recursive: true});

(async () => {
  const harness = await createHarness(root);
  const {fixture, storage} = harness;
  const originalIncidents = [
    {id: 'PINC001', status: 'triggered', urgency: 'high', priority: {name: 'P1'}},
    {id: 'PINC002', status: 'acknowledged', urgency: 'high', priority: {name: 'P2'}},
    {id: 'PINC003', status: 'triggered', urgency: 'low', priority: {name: 'P4'}}
  ];
  fixture.incidents = originalIncidents;
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--disable-crashpad', '--disable-crash-reporter']
  });
  const context = await browser.newContext({viewport: {width: 1440, height: 1160}});
  await harness.attach(context);
  try {
    const errors = [];
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    await context.route('https://**.pagerduty.com/**', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><html><head><title>Incidents · PagerDuty</title><link id="original-icon" rel="icon" href="/original.png"></head><body><h1>PagerDuty test fixture</h1></body></html>'}));
    const options = await context.newPage();
    await options.goto(`${harness.base}options.html`);
    await options.waitForFunction(() => document.querySelector('#color-critical')?.value === '#dc3454');
    await options.screenshot({path: path.join(work, 'settings-disconnected.png'), fullPage: true});
    const pd = await context.newPage();
    await pd.goto('https://acme.pagerduty.com/incidents');
    await pd.addScriptTag({path: path.join(extension, 'content.js')});
    await options.locator('#token').fill('synthetic-browser-test-token');
    await options.locator('#connect').click();
    await options.locator('#connection-pill.connected').waitFor();
    await pd.locator('link[data-pagerduty-signal]').waitFor({state: 'attached'});
    assert.equal(await pd.locator('#original-icon').count(), 0);
    const favicon = () => pd.locator('link[data-pagerduty-signal]').getAttribute('href');
    const critical = await favicon(); assert.match(critical, /^data:image\/png;base64,/);
    let state = await options.evaluate(() => chrome.runtime.sendMessage({type: 'GET_STATE'}));
    assert.equal(state.state.summary.level, 'critical'); assert.equal(state.state.summary.count, 3);
    assert.equal(JSON.stringify(state).includes('synthetic-browser-test-token'), false);
    console.log('PASS: connected user, highest severity, count, PNG favicon, no token in public state');

    const refresh = () => options.evaluate(() => chrome.runtime.sendMessage({type: 'REFRESH'}));
    const save = settings => options.evaluate(s => chrome.runtime.sendMessage({type: 'SAVE_SETTINGS', settings: s}), settings);
    fixture.incidents = [{id: 'PINC004', status: 'triggered', urgency: 'low', priority: {name: 'P4'}}];
    await refresh(); await pd.waitForFunction(old => document.querySelector('link[data-pagerduty-signal]')?.href !== old, critical);
    const low = await favicon();
    fixture.incidents = [];
    state = await refresh(); assert.equal(state.state.summary.level, 'clear');
    await pd.waitForFunction(old => document.querySelector('link[data-pagerduty-signal]')?.href !== old, low);
    const clear = await favicon();
    console.log('PASS: severity changes and no-incident all-clear update the real tab favicon');

    // PagerDuty is an SPA and can replace or mutate icon elements during navigation.
    await pd.evaluate(() => { const link = document.createElement('link'); link.rel = 'icon'; link.id = 'spa-icon'; link.href = '/spa.png'; document.head.append(link); });
    await pd.locator('#spa-icon').waitFor({state: 'detached'});
    await pd.evaluate(() => { const link = document.querySelector('link[data-pagerduty-signal]'); link.href = '/tampered.png'; link.rel = 'alternate'; });
    await pd.waitForFunction(expected => document.querySelector('link[data-pagerduty-signal]')?.href === expected && document.querySelector('link[data-pagerduty-signal]')?.rel === 'icon', clear);
    state = await options.evaluate(() => chrome.runtime.sendMessage({type: 'GET_STATE'}));
    await save({...state.settings, enabled: false});
    await pd.locator('link[data-pagerduty-signal]').waitFor({state: 'detached'});
    assert.equal(await pd.locator('#original-icon').count(), 1); assert.equal(await pd.locator('#spa-icon').count(), 1);
    await save({...state.settings, enabled: true}); await pd.locator('link[data-pagerduty-signal]').waitFor({state: 'attached'});
    console.log('PASS: SPA favicon replacement, favicon tampering, and pause restoration');

    const other = await context.newPage(); await other.goto('https://other.pagerduty.com/incidents');
    await other.addScriptTag({path: path.join(extension, 'content.js')});
    assert.equal(await other.locator('link[data-pagerduty-signal]').count(), 0);
    // Content scripts must be unable to read locally remembered tokens or invoke privileged operations.
    assert.equal(storage.local.accessLevel, 'TRUSTED_CONTEXTS');
    assert.equal(storage.session.accessLevel, 'TRUSTED_CONTEXTS');
    assert.equal(storage.local.data.savedToken, undefined);
    const denied = await pd.evaluate(() => chrome.runtime.sendMessage({type: 'GET_STATE'}));
    assert.equal(denied.ok, false);
    await save({...state.settings, activeOnly: true});
    await harness.activate(other); await pd.locator('link[data-pagerduty-signal]').waitFor({state: 'detached'});
    await harness.activate(pd); await pd.locator('link[data-pagerduty-signal]').waitFor({state: 'attached'});
    await harness.activate(options); await pd.locator('link[data-pagerduty-signal]').waitFor({state: 'detached'});
    await save({...state.settings, activeOnly: false}); await pd.locator('link[data-pagerduty-signal]').waitFor({state: 'attached'});
    console.log('PASS: account isolation, session-only token storage, and active-tab mode');

    // Exercise the real settings form, not only its runtime message API.
    fixture.incidents = originalIncidents;
    await options.locator('#scope').selectOption('services');
    await options.locator('#service-ids').fill('PSERV01');
    await options.locator('#poll-seconds').selectOption('300');
    await options.locator('#include-acknowledged').uncheck();
    await options.locator('#show-count').uncheck();
    await options.locator('#color-critical').fill('#7c3aed');
    await options.locator('#save').click();
    await options.waitForFunction(() => document.querySelector('#settings-feedback').textContent === 'Preferences saved.');
    state = await options.evaluate(() => chrome.runtime.sendMessage({type: 'GET_STATE'}));
    assert.equal(state.settings.scope, 'services'); assert.equal(state.settings.colors.critical, '#7c3aed');
    assert.equal(state.state.summary.count, 2); assert.equal(state.state.summary.acknowledged, 0);
    assert.equal(harness.alarms.get('signal-poll').periodInMinutes, 5);
    await options.reload(); await options.waitForFunction(() => document.querySelector('#scope').value === 'services');
    assert.equal(await options.locator('#color-critical').inputValue(), '#7c3aed');
    assert.equal(await options.locator('#show-count').isChecked(), false);
    await options.locator('#reset').click(); await options.locator('#save').click();
    await options.waitForFunction(() => document.querySelector('#settings-feedback').textContent === 'Preferences saved.');
    fixture.incidents = []; await refresh();
    console.log('PASS: form save/reload, custom colors, service scope, acknowledgement filter, interval, and reset');

    fixture.mode = 'offline';
    state = await refresh(); assert.equal(state.display.level, 'stale'); assert.ok(state.state.error);
    const stale = await favicon(); assert.notEqual(stale, clear);
    const countBefore = fixture.calls; await refresh();
    assert.equal(fixture.calls, countBefore);
    console.log('PASS: offline state replaces all-clear; retry backoff prevents duplicate requests');

    // Re-enable checks and simulate a stale cache after a service worker restart or machine sleep.
    fixture.mode = 'ok'; storage.session.data.state.retryAt = 0;
    await refresh();
    storage.session.data.state.checkedAt = Date.now() - 600000;
    state = await options.evaluate(() => chrome.runtime.sendMessage({type: 'GET_STATE'})); assert.equal(state.display.level, 'stale');
    fixture.mode = 'rate-limit';
    state = await refresh(); assert.equal(state.display.level, 'stale'); assert.ok(state.state.retryAt > Date.now() + 110000);
    console.log('PASS: stale cached results and HTTP 429 Retry-After');

    fixture.mode = 'ok'; fixture.incidents = originalIncidents; storage.session.data.state.retryAt = 0;
    await options.locator('#token').fill('synthetic-browser-test-token');
    await options.locator('#remember').check(); await options.locator('#connect').click();
    await options.waitForFunction(() => document.querySelector('#token').value === '' && !document.querySelector('#connect').disabled);
    assert.equal(storage.local.data.savedToken, 'synthetic-browser-test-token');
    // Simulate a new browser session losing ephemeral state while remembered credentials remain.
    await storage.session.clear(); await refresh();
    state = await options.evaluate(() => chrome.runtime.sendMessage({type: 'GET_STATE'}));
    assert.equal(state.connected, true); assert.equal(state.remembered, true); assert.equal(state.state.summary.level, 'critical');
    console.log('PASS: opt-in token persistence and reconnect from persisted credentials');
    await options.reload();
    await options.locator('#connection-pill.connected').waitFor();
    await options.screenshot({path: path.join(work, 'settings-desktop.png'), fullPage: true});
    await options.setViewportSize({width: 390, height: 844});
    assert.equal(await options.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await options.screenshot({path: path.join(work, 'settings-mobile.png'), fullPage: true});
    const popup = await context.newPage(); await popup.setViewportSize({width: 370, height: 590});
    await popup.goto(`${harness.base}popup.html`);
    await popup.waitForFunction(() => document.querySelector('#status-title').textContent === 'Critical');
    await popup.screenshot({path: path.join(work, 'popup.png'), fullPage: true});
    await popup.locator('#pause').click(); await popup.waitForFunction(() => document.querySelector('#status-title').textContent === 'Monitoring paused');
    assert.equal(await popup.locator('#pause').textContent(), 'Resume');
    await popup.locator('#pause').click(); await popup.waitForFunction(() => document.querySelector('#status-title').textContent === 'Critical');
    console.log('PASS: responsive settings, popup, and pause/resume controls');

    state = await options.evaluate(() => chrome.runtime.sendMessage({type: 'DISCONNECT'}));
    assert.equal(state.connected, false);
    await pd.locator('link[data-pagerduty-signal]').waitFor({state: 'detached'});
    assert.equal(await pd.locator('#original-icon').count(), 1);
    assert.equal(JSON.stringify({local: storage.local.data, session: storage.session.data}).includes('synthetic-browser-test-token'), false);
    assert.deepEqual(errors, []);
    console.log('PASS: disconnect removes credentials, restores favicon; no page errors');
    console.log('All browser integration checks passed. Screenshots saved in work/.');
  } finally { await browser.close(); await harness.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
