// Relays content-script requests to the native host. The host name always comes from the
// sender's URL (or the stored pending login), never from the message, so a page can only
// read or save its own login. Pending logins live in storage.session: memory only.
const HOST = 'com.roykisluk.autologin';
const PENDING_MS = 5 * 60 * 1000;
const native = (msg) => new Promise((resolve) =>
  chrome.runtime.sendNativeMessage(HOST, msg, (res) => resolve(res || { error: chrome.runtime.lastError?.message })));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function handle(msg, sender) {
  const host = new URL(sender.url).host;
  const tab = 'tab:' + sender.tab.id;
  const pending = (await chrome.storage.session.get(tab))[tab];
  const { never = [] } = await chrome.storage.local.get('never');

  if (msg.op === 'get') return native({ op: 'get', host });
  if (msg.op === 'pending') {
    if (!never.includes(host)) await chrome.storage.session.set({ [tab]: { host, record: msg.record, ts: Date.now() } });
    return {};
  }
  if (!pending) return {};
  if (Date.now() - pending.ts > PENDING_MS) return chrome.storage.session.remove(tab).then(() => ({}));
  if (msg.op === 'offer') {
    const saved = await native({ op: 'get', host: pending.host });
    if (saved.record && same(saved.record, pending.record)) return chrome.storage.session.remove(tab).then(() => ({}));
    return { host: pending.host };
  }
  await chrome.storage.session.remove(tab);
  if (msg.op === 'save') return native({ op: 'set', host: pending.host, record: pending.record });
  if (msg.op === 'never') await chrome.storage.local.set({ never: [...never, pending.host] });
  return {};
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  handle(msg, sender).then(reply, (e) => reply({ error: String(e) }));
  return true;
});

// RUNI Moodle: its SSO redirect goes to auth.runi.ac.il with the Moodle page in RelayState.
// Catch it before the Duo page loads and log in with the Moodle app token instead (host.py 'moodle').
// On failure, reopen the Moodle page so the normal login runs, and stay out of the way for a minute (no loop).
let runiSkipUntil = 0; // ponytail: lives in the worker; if Brave unloads it, the next try just asks again
chrome.webRequest.onBeforeRequest.addListener((d) => {
  const back = new URL(d.url).searchParams.get('RelayState') || '';
  if (d.tabId < 0 || Date.now() < runiSkipUntil || !back.startsWith('https://moodle.runi.ac.il/')) return;
  chrome.tabs.update(d.tabId, { url: chrome.runtime.getURL('runi.html') });
  native({ op: 'moodle', url: back }).then((r) => {
    if (!r.url) { runiSkipUntil = Date.now() + 60000; console.log('RUNI autologin failed:', r.error); }
    chrome.tabs.update(d.tabId, { url: r.url || back }); // back: Moodle starts a fresh SSO (a reused SAML URL gives F5 errorcode 19)
  });
}, { urls: ['https://auth.runi.ac.il/saml/*'], types: ['main_frame'] });
