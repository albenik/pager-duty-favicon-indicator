const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {pathToFileURL} = require('node:url');

// Chrome API test double: production background.js runs unchanged, browser pages use a message bridge.
module.exports = async function createHarness(root) {
  const event = () => ({listeners: [], addListener(fn) { this.listeners.push(fn); }});
  const storage = () => ({data: {}, accessLevel: '', async get(keys) {
    if (keys == null) return structuredClone(this.data);
    return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(k => k in this.data).map(k => [k, structuredClone(this.data[k])]));
  }, async set(values) { Object.assign(this.data, structuredClone(values)); }, async remove(keys) { for (const k of Array.isArray(keys) ? keys : [keys]) delete this.data[k]; },
  async clear() { this.data = {}; }, async setAccessLevel(value) { this.accessLevel = value.accessLevel; }});
  const server = http.createServer((request, response) => {
    const relative = new URL(request.url, 'http://localhost').pathname;
    const target = path.resolve(root, 'extension', '.' + relative);
    if (!target.startsWith(path.join(root, 'extension') + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png'}[path.extname(target)] || 'application/octet-stream');
    response.end(fs.readFileSync(target));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const pages = new Map(); let nextTab = 1; let activeTab = 0;
  const tabs = () => [...pages].filter(([, p]) => !p.isClosed()).map(([id, p]) => ({id, url: p.url(), active: id === activeTab, windowId: 1}));
  const alarms = new Map();
  globalThis.chrome = {
    storage: {local: storage(), session: storage()},
    runtime: {id: 'signal-harness', getURL: p => base + p, onMessage: event(), onInstalled: event(), onStartup: event()},
    alarms: {async clear(name) { return alarms.delete(name); }, async create(name, spec) { alarms.set(name, spec); }, onAlarm: event()},
    tabs: {
      async query({url} = {}) { return tabs().filter(t => !url || (Array.isArray(url) ? url : [url]).some(pattern => new RegExp('^' + pattern.split('*').map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(t.url))); },
      async sendMessage(id, message) { const p = pages.get(id); if (!p || p.isClosed()) return; await p.evaluate(m => (globalThis.__messageListeners || []).forEach(fn => fn(m)), message); },
      onActivated: event(), onUpdated: event()
    },
    action: {async setBadgeText() {}, async setBadgeBackgroundColor() {}, async setTitle() {}}
  };
  const fixture = {mode: 'ok', incidents: [], calls: 0};
  globalThis.fetch = async url => {
    fixture.calls++;
    if (fixture.mode === 'offline') throw new Error('network unavailable');
    if (fixture.mode === 'rate-limit') return new Response('{}', {status: 429, headers: {'Retry-After': '120'}});
    const u = new URL(url);
    if (u.pathname === '/users/me') return new Response(JSON.stringify({user: {
      id: 'PUSER01', name: 'Ada Lin', email: 'ada@example.com', html_url: 'https://acme.pagerduty.com/users/PUSER01', teams: [{id: 'PTEAM01', summary: 'Platform'}]
    }}));
    if (u.pathname === '/incidents') {
      if (!u.searchParams.has('user_ids[]') && !u.searchParams.has('team_ids[]') && !u.searchParams.has('service_ids[]')) throw new Error('Unbounded incident query');
      return new Response(JSON.stringify({incidents: fixture.incidents, more: false}));
    }
    throw new Error('Unexpected API call');
  };
  await import(pathToFileURL(path.join(root, 'extension/background.js')).href);
  const send = (message, sender) => new Promise(resolve => chrome.runtime.onMessage.listeners[0](message, sender, resolve));
  return {base, fixture, alarms, storage: chrome.storage,
    async attach(context) {
      await context.exposeBinding('__harnessSend', async ({page}, message) => {
        let id = [...pages].find(([, p]) => p === page)?.[0];
        if (!id) { id = nextTab++; pages.set(id, page); }
        const sender = {id: chrome.runtime.id, url: page.url(), frameId: 0};
        if (!page.url().startsWith(base)) sender.tab = tabs().find(t => t.id === id);
        return send(message, sender);
      });
      await context.addInitScript(() => {
        globalThis.__messageListeners = [];
        globalThis.chrome = {runtime: {sendMessage: message => globalThis.__harnessSend(message), onMessage: {addListener: fn => globalThis.__messageListeners.push(fn)}, openOptionsPage: () => {}}, storage: {}};
      });
    },
    async activate(page) {
      await page.bringToFront();
      let id = [...pages].find(([, p]) => p === page)?.[0]; if (!id) { id = nextTab++; pages.set(id, page); }
      activeTab = id;
      await Promise.all(chrome.tabs.onActivated.listeners.map(fn => fn({tabId: id, windowId: 1})));
    },
    async close() { await new Promise(resolve => server.close(resolve)); }
  };
};
