# PagerDuty Signal

A dependency-free Chrome Manifest V3 extension that turns a PagerDuty tab’s favicon into a small incident status indicator. It polls the documented REST API, scopes incidents to your responsibilities, and displays the highest matching severity.

## Install

1. Use Chrome 120 or later (or a compatible Chromium browser).
2. Open `chrome://extensions` and enable **Developer mode**.
3. Choose **Load unpacked**, then select this repository’s **extension** directory, which contains `manifest.json`.
4. Open **Details → Extension options**, or pin Signal and use its toolbar settings button.
5. In PagerDuty, create a **personal user API token** under **My Profile → User Settings → API Access**. Use the same user you are signed in as. Account-level keys, Events API integration keys, and OAuth bearer tokens are not supported by this implementation.
6. Choose the **United States** or **European Union** data region, paste the token, and click **Connect account**. Signal detects your account URL through `GET /users/me`. Confirm the displayed user and account.
7. Set your preferences, click **Save preferences**, and reload PagerDuty tabs that were open before you installed the extension.

There is no build step or production dependency to install. An organization’s managed-browser policy may prohibit unpacked extensions; installation then requires the organization’s approved extension distribution process.

## Authentication and responsibility scope

Signal uses a personal REST API token, rather than PagerDuty’s web session cookies or undocumented internal endpoints. **The token owner is the monitored user.** Sign in to PagerDuty as that user, and reconnect Signal when switching users. Signal does not automatically follow browser-session identity changes. Only tabs whose origin matches the verified account are changed. US and EU REST API hosts are selected explicitly.

| Scope | Definition |
| --- | --- |
| Assigned to me (default) | Incidents currently assigned to the token owner (`user_ids[]`). |
| My teams | Incidents related to any team returned by the user’s current team memberships (`team_ids[]`). A user with no teams gets an empty result, never an account-wide query. |
| Selected teams | Incidents related to any configured team ID. |
| Selected services | Incidents belonging to any configured service ID. |

Selected teams and services must be accessible to the authenticated user. These scopes deliberately broaden monitoring beyond personal assignments. Team filtering follows PagerDuty’s incident-list association semantics; it is not an inference of service ownership, escalation-policy membership, or current on-call schedules.

All scopes query triggered incidents and, by default, acknowledged incidents. Resolved incidents never affect the favicon. Queries use `date_range=all` so that long-running open incidents are not lost to the API’s default date window. Every page is loaded before publishing a new result. Missing pages, malformed responses, and pagination limits produce an unavailable status instead of a false all-clear.

## Favicon behavior

| State | Default color | Meaning |
| --- | --- | --- |
| All clear | Green | A complete successful check returned no matching open incidents. A check mark replaces the count. |
| Critical | Red | A matching priority name is `P1` or `SEV1`. |
| High | Orange | A matching priority name is `P2` or `SEV2`, or the incident falls back to high urgency. |
| Medium | Amber | A matching priority name is `P3` or `SEV3`. |
| Low | Blue | A matching priority name is `P4`, `P5`, `SEV4`, or `SEV5`, or the incident has low urgency. |
| Unavailable | Gray question mark | A request failed, a result is incomplete, or the last successful result is stale. |

The highest severity wins across all matching incidents, regardless of their order or acknowledgement state. The optional count shows **all open incidents in the selected scope**, not just incidents at that severity, and caps at `99+`. Turning the count off shows an exclamation mark. The popup separately shows triggered and acknowledged totals.

The default **Priority, then urgency** mode maps priority names using configurable, case-insensitive rules. Unmapped or absent priorities fall back to incident urgency: low → Low, otherwise → High. This does not fetch or infer individual alert payload severities. **Urgency only** ignores priority and uses High/Low directly. Colors, priority names, inclusion of acknowledged incidents, and count display are customizable.

The default is to update all open tabs for the connected account, including the active tab. **Active tab only** applies the signal to the selected tab in each Chrome window and restores original icons elsewhere. The extension observes favicon changes so PagerDuty’s client-side navigation does not overwrite the indicator. Pausing or disconnecting restores the original favicon links, including icons added by the app while monitoring. If you disable or uninstall the extension through Chrome itself, reload affected tabs to restore their native icons.

## Refresh and failure handling

- Choose 30 seconds, 1 minute (default), 2 minutes, or 5 minutes. `chrome.alarms` supports Manifest V3 worker suspension; no always-running background page is required.
- Each successful refresh verifies the user and current team memberships, then fetches all incident pages. It can run with no PagerDuty tab open.
- Requests time out after 15 seconds. Failed requests use bounded exponential backoff up to five minutes; HTTP 429 honors `Retry-After`. The refresh button also honors this cooldown.
- A result older than the greater of two refresh intervals or two minutes is marked stale. Content scripts check presentation freshness every 30 seconds and on tab visibility changes without making extra API requests. Chrome may throttle timers and alarms during sleep, so this is polling rather than real-time notification.
- Preferences and connection changes are serialized with refreshes to prevent an older in-flight response from overwriting a new connection or scope.

## Privacy and permissions

- Tokens are session-only by default (`chrome.storage.session`). Opting into **Remember token** stores the token in `chrome.storage.local`, without additional encryption. It remains within the Chrome profile; it is never synced. Treat profile access as access to that token.
- Both storage areas are restricted to `TRUSTED_CONTEXTS`. Content scripts receive only a favicon presentation payload (color, status, count, and label), not tokens, emails, team memberships, or full incident data. Settings and connection operations reject content-script senders.
- Disconnect removes both token copies and cached user/status information. Preferences stay local. API responses are reduced to user identity, team references, counts, and check/error metadata; incident titles and descriptions are not persisted.
- API calls are GET-only, omit cookies, reject redirects, and go directly to `api.pagerduty.com` or `api.eu.pagerduty.com`. This extension does not acknowledge, resolve, or otherwise modify incidents.
- `storage` keeps preferences, credentials, and short-lived state. `alarms` schedules polling. The `https://*.pagerduty.com/*` host permission covers the API hosts and PagerDuty account tabs for favicon injection. There are no `<all_urls>`, cookie, notification, history, or analytics permissions.
- No external fonts, scripts, analytics, or third-party servers are used at runtime.

## Development and verification

```sh
npm test
npm run test:browser
npm run package
```

`npm test` uses Node 22+ built-ins and covers severity precedence, acknowledgement filtering, resource scoping, empty-team isolation, settings validation, identity validation, pagination and partial failures, credential-safe errors, and rate-limit delays.

`npm run test:browser` needs Playwright and a Chromium executable (`CHROMIUM_PATH`, default `/usr/bin/chromium`). If Playwright is not already provided by your environment, install it separately with `npm install --no-save playwright`. The browser suite uses the production background, content, options, and popup code with a Chrome API test double and synthetic PagerDuty responses. It checks actual PNG favicon changes in a browser DOM, SPA mutations, original-icon restoration, active-tab and account isolation, content-sender restrictions, storage access configuration, stale/offline/429 states, responsive layouts, and pause/resume/disconnect. Screenshots are written to `work/`.

The managed Chromium supplied for this development task blocks unpacked extensions by policy. **The browser suite is a harness, not a live MV3 installation or an authenticated PagerDuty end-to-end test.** Validate the following in an unmanaged development profile or your approved enterprise installation:

1. Connect your personal token in the correct region and verify the displayed identity and account.
2. Compare the selected scope’s counts with PagerDuty, including a long-running incident and an acknowledged incident.
3. Confirm favicon updates after creation, priority changes, acknowledgement, and resolution of an appropriate test incident.
4. Navigate within PagerDuty, reload a tab, switch active tabs, and pause/resume monitoring.
5. Disconnect the network and verify the question-mark state; reconnect and wait for the retry.
6. Close/reopen Chrome to check session-only versus remembered-token behavior; inspect the service worker and alarm in `chrome://extensions`.
7. Verify the favicon loads under your organization’s PagerDuty Content Security Policy (generated favicons use PNG data URLs).

`npm run package` validates manifest references and creates a ZIP with `extension/`, this README, and the MIT license. The output directory can be passed with `python3 scripts/package.py --out <directory>`; the default staging directory is `work/release`.

## Layout

```text
extension/
  manifest.json         Chrome MV3 manifest
  background.js         Identity, credential storage, polling, alarms, and tab updates
  content.js            PNG favicon generation, SPA monitoring, original-icon restoration
  lib/                  Validated settings, REST client, incident summaries, shared UI helpers
  options.html/js       Full settings panel and live favicon preview
  popup.html/js         Current status, counts, refresh, pause, and PagerDuty shortcut
  styles.css            Responsive settings and popup styling
tests/                  Core checks and Chromium harness
scripts/package.py      Dependency-free release packager
```

## API references

- [PagerDuty: Get the current user](https://docs.pagerduty.com/developer/api/reference/rest/users/get-current-user)
- [PagerDuty: List incidents](https://docs.pagerduty.com/developer/api/reference/rest/incidents/list-incidents)
- [Chrome: Alarms API](https://developer.chrome.com/docs/extensions/reference/api/alarms)
- [Chrome: Storage access levels](https://developer.chrome.com/docs/extensions/reference/api/storage#access-level)

MIT licensed. Signal is independent of PagerDuty and is not endorsed by PagerDuty.
