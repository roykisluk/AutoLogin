// Runs on every https page that shows a password field.
// - Saved login for this host -> fill it and submit (once per 10 min).
// - You log in by hand -> offer to save what you typed (bar on the next page, or here after 3 s).
const COOLDOWN_MS = 10 * 60 * 1000; // a wrong saved password can't lock the account
const OTP = 'input[autocomplete=one-time-code]';
const visible = (el) => el && el.offsetParent !== null;
const ask = (msg) => chrome.runtime.sendMessage(msg);
const selector = (el) =>
  el.id ? '#' + CSS.escape(el.id) : el.name ? `${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"]` : null;

const loginPassword = () =>
  [...document.querySelectorAll('input[type=password]')].find((el) => visible(el) && !el.matches(OTP));
// The button Enter would press: first visible submit-like button in the form (or page).
const defaultButton = (pw) =>
  [...(pw.form || document).querySelectorAll('button[type=submit], input[type=submit], button:not([type])')].find(visible);

// Visible text-like inputs of the login form (or the whole page when the form has no <form>).
function loginFields() {
  const pw = loginPassword();
  if (!pw) return [];
  return [...(pw.form || document).querySelectorAll('input')].filter((el) =>
    visible(el) && !el.matches(OTP) && ['text', 'email', 'tel', 'number', 'password'].includes(el.type));
}

function fill(rec) {
  for (const [sel, value] of Object.entries(rec.fields)) {
    const el = document.querySelector(sel);
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const pw = document.querySelector(Object.keys(rec.fields).find((s) => document.querySelector(s).type === 'password'));
  const btn = (rec.submit && document.querySelector(rec.submit)) || (pw && defaultButton(pw));
  if (btn) btn.click();
  else if (pw && pw.form) pw.form.requestSubmit();
  else if (pw) for (const type of ['keydown', 'keypress', 'keyup']) // last resort: Enter in the password field
    pw.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
}

async function autofill() {
  if ([...document.querySelectorAll(OTP)].some(visible)) return; // 2FA step: leave it to the human
  const res = await ask({ op: 'get' });
  if (res && res.error) console.log('[autologin]', res.error);
  if (!res || !res.record) return;
  const key = 'last:' + location.host;
  if (Date.now() - ((await chrome.storage.local.get(key))[key] || 0) < COOLDOWN_MS) return;
  if (!Object.keys(res.record.fields).every((s) => visible(document.querySelector(s)))) return;
  await chrome.storage.local.set({ [key]: Date.now() });
  fill(res.record);
}

// Capture a hand-typed login at the moment you submit it.
function capture(button) {
  const fields = loginFields();
  if (!fields.some((el) => el.type === 'password' && el.value)) return;
  button = button || defaultButton(loginPassword()); // Enter pressed: remember the button it stands for
  const rec = { fields: {}, submit: button && selector(button) };
  for (const el of fields) { const s = selector(el); if (s && el.value) rec.fields[s] = el.value; }
  ask({ op: 'pending', record: rec });
  setTimeout(offer, 3000); // single-page apps that don't navigate after login
}
addEventListener('click', (e) => {
  const b = e.isTrusted && e.target.closest('button, input[type=submit], [role=button]');
  if (b) capture(b);
}, true);
addEventListener('keydown', (e) => {
  if (e.isTrusted && e.key === 'Enter' && e.target.matches && e.target.matches('input')) capture(null);
}, true);

async function offer() {
  const res = await ask({ op: 'offer' });
  if (!res || !res.host || document.getElementById('autologin-bar')) return;
  const bar = document.createElement('div');
  bar.id = 'autologin-bar';
  const root = bar.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>
    div{position:fixed;top:12px;right:12px;z-index:2147483647;background:#1f2937;color:#fff;font:14px system-ui;
        padding:10px 12px;border-radius:8px;box-shadow:0 4px 16px #0005;display:flex;gap:8px;align-items:center}
    button{font:inherit;border:0;border-radius:6px;padding:4px 10px;cursor:pointer}
    .save{background:#3b82f6;color:#fff}</style>
    <div><span></span><button class=save>Save</button><button class=never>Never</button><button class=x>✕</button></div>`;
  root.querySelector('span').textContent = `Save login for ${res.host}?`;
  const done = (op) => { ask({ op }); bar.remove(); };
  root.querySelector('.save').onclick = () => done('save');
  root.querySelector('.never').onclick = () => done('never');
  root.querySelector('.x').onclick = () => done('dismiss');
  document.documentElement.append(bar);
}

offer();
let tries = 0;
const timer = setInterval(() => { // login forms are often rendered late by JS
  if (++tries > 50) return clearInterval(timer); // ~15 s
  if (!loginFields().length) return;
  clearInterval(timer);
  autofill();
}, 300);
