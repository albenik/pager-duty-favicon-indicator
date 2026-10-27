import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS, normalizeSettings, normalizeOrigin, requireScope} from '../extension/lib/settings.js';
import {incidentParams, summarize, severityOf} from '../extension/lib/incidents.js';
import {PagerDutyClient, retryTime} from '../extension/lib/api.js';

const settings = (value = {}) => normalizeSettings(value);
const user = {id: 'PUSER01', teams: [{id: 'PTEAM01'}, {id: 'PTEAM02'}]};
const incident = (id, priority = 'P1', status = 'triggered', urgency = 'high') => ({id, priority: priority ? {name: priority} : null, status, urgency});
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {status, headers});

test('highest severity wins independently of incident ordering, counts are deduplicated', () => {
  const result = summarize([incident('1', 'P4'), incident('2', 'P2', 'acknowledged'), incident('3', 'P1'), incident('1', 'P4'), incident('4', 'P1', 'resolved')], settings());
  assert.equal(result.level, 'critical'); assert.equal(result.count, 3); assert.equal(result.triggered, 2); assert.equal(result.acknowledged, 1);
  assert.deepEqual(result.counts, {critical: 1, high: 1, medium: 0, low: 1});
});
test('empty and resolved-only results are clear; acknowledged incidents are optional', () => {
  assert.equal(summarize([], settings()).level, 'clear');
  assert.equal(summarize([incident('1', 'P1', 'resolved')], settings()).level, 'clear');
  assert.equal(summarize([incident('1', 'P1', 'acknowledged')], settings({includeAcknowledged: false})).count, 0);
});
test('custom names ignore case, unknown priorities use urgency, urgency mode ignores priorities', () => {
  assert.equal(severityOf(incident('1', 'sev1'), settings()), 'critical');
  assert.equal(severityOf(incident('1', 'Other', 'triggered', 'low'), settings()), 'low');
  assert.equal(severityOf(incident('1', null), settings()), 'high');
  assert.equal(severityOf(incident('1', 'P1', 'triggered', 'low'), settings({severitySource: 'urgency'})), 'low');
  assert.equal(severityOf(incident('1', 'Disaster'), settings({priorityRules: {critical: ['DISASTER']}})), 'critical');
});
test('all scopes are bounded to user, teams, or services; empty my-teams never queries all incidents', () => {
  const assigned = incidentParams(settings(), user);
  assert.equal(assigned.get('date_range'), 'all'); assert.deepEqual(assigned.getAll('user_ids[]'), ['PUSER01']);
  assert.deepEqual(assigned.getAll('statuses[]'), ['triggered', 'acknowledged']);
  assert.deepEqual(incidentParams(settings({includeAcknowledged: false}), user).getAll('statuses[]'), ['triggered']);
  assert.deepEqual(incidentParams(settings({scope: 'my-teams'}), user).getAll('team_ids[]'), ['PTEAM01', 'PTEAM02']);
  assert.equal(incidentParams(settings({scope: 'my-teams'}), {id: 'PUSER01', teams: []}), null);
  assert.deepEqual(incidentParams(settings({scope: 'teams', teamIds: ['PTEAM03']}), user).getAll('team_ids[]'), ['PTEAM03']);
  assert.deepEqual(incidentParams(settings({scope: 'services', serviceIds: ['PSERV01']}), user).getAll('service_ids[]'), ['PSERV01']);
  assert.throws(() => requireScope(settings({scope: 'services'})), /at least one/);
  assert.throws(() => incidentParams(settings({scope: 'teams'}), user), /at least one/);
});
test('settings reject unsafe origins, malformed IDs, duplicate priority names, and unknown values', () => {
  assert.equal(normalizeOrigin('https://acme.eu.pagerduty.com/'), 'https://acme.eu.pagerduty.com');
  for (const value of ['https://api.pagerduty.com', 'https://acme.pagerduty.com.evil.test', 'http://acme.pagerduty.com', 'https://me:secret@acme.pagerduty.com', 'https://acme.pagerduty.com/path']) assert.throws(() => normalizeOrigin(value));
  assert.throws(() => settings({teamIds: ['bad&query']}));
  assert.throws(() => settings({pollSeconds: 1}));
  assert.throws(() => settings({priorityRules: {critical: ['P2']}}), /only one/);
  assert.throws(() => settings({colors: {critical: 'red'}}));
  assert.throws(() => settings({enabled: 'yes'}));
  assert.equal('token' in settings({token: 'secret'}), false);
  assert.equal(DEFAULTS.colors.critical, '#dc3454');
});
test('current user is verified, teams retained, unnecessary sensitive profile fields discarded', async () => {
  const calls = [];
  const client = new PagerDutyClient('secret', 'eu', async (url, options) => {
    calls.push({url, options});
    return json({user: {id: 'PUSER01', name: 'Ada Lin', email: 'ada@example.com', html_url: 'https://acme.eu.pagerduty.com/users/PUSER01', teams: [{id: 'PTEAM01', summary: 'Platform'}], http_cal_url: 'private'}});
  });
  const result = await client.currentUser();
  assert.equal(result.accountOrigin, 'https://acme.eu.pagerduty.com'); assert.equal(result.teams[0].name, 'Platform'); assert.equal('http_cal_url' in result, false);
  assert.equal(calls[0].options.credentials, 'omit'); assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.headers.Authorization, 'Token token=secret');
  assert.match(calls[0].url, /^https:\/\/api.eu.pagerduty.com\/users\/me/);
  await assert.rejects(new PagerDutyClient('x', 'us', async () => json({user: {id: 'PUSER01', html_url: 'https://evil.test'}})).currentUser(), /valid user/);
});
test('all pages are loaded, including higher-severity incidents on later pages', async () => {
  const offsets = [];
  const client = new PagerDutyClient('secret', 'us', async url => {
    const offset = new URL(url).searchParams.get('offset'); offsets.push(offset);
    return offset === '0' ? json({incidents: [incident('1', 'P4')], more: true}) : json({incidents: [incident('2', 'P1')], more: false});
  });
  const incidents = await client.incidents(settings(), user);
  assert.deepEqual(offsets, ['0', '100']); assert.equal(summarize(incidents, settings()).level, 'critical');
});
test('pagination failures, invalid data, and partial pages are errors, never an all-clear result', async () => {
  for (const value of [{incidents: []}, {incidents: [], more: true}, {incidents: [{}], more: false}, {more: false}]) {
    await assert.rejects(new PagerDutyClient('x', 'us', async () => json(value)).incidents(settings(), user));
  }
  let n = 0;
  await assert.rejects(new PagerDutyClient('x', 'us', async () => ++n === 1 ? json({incidents: [incident('1')], more: true}) : json({}, 500)).incidents(settings(), user), /HTTP 500/);
});
test('network errors and authorization errors contain no token or response body', async () => {
  for (const response of [() => { throw new Error('secret transport detail'); }, () => json({error: 'secret'}, 401), () => json({error: 'secret'}, 403)]) {
    const client = new PagerDutyClient('super-secret', 'us', response);
    await assert.rejects(client.currentUser(), e => !e.message.includes('secret'));
  }
  const client = new PagerDutyClient('secret', 'us', async () => json({}, 200));
  await assert.rejects(client.get('https://evil.test/users/me'), /Unsupported/);
});
test('429 honors Retry-After seconds and HTTP date', async () => {
  const before = Date.now();
  await assert.rejects(new PagerDutyClient('x', 'us', async () => json({}, 429, {'Retry-After': '120'})).currentUser(), e => e.status === 429 && e.retryAt >= before + 120000);
  assert.equal(retryTime('60', 1000), 61000);
  assert.equal(retryTime('invalid', 1000), 61000);
  assert.equal(retryTime('Thu, 01 Jan 1970 00:03:00 GMT', 1000), 180000);
});
