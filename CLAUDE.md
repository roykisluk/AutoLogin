# AutoLogin

Brave extension that works like a tiny password manager on every https site: when you log in
by hand it offers to save what you typed; next time it fills and submits by itself. Logins are
stored in one age-encrypted file in iCloud Drive; its key is only in this Mac's login Keychain
(Roy keeps a copy of the key in the Apple Passwords app).

```
extension/content.js  runs on every https page with a password field: autofill, capture, save bar
extension/bg.js       relays to the native host; host name always from the sender URL
host.py               native messaging host: get/set records in the encrypted iCloud file;
                      op 'moodle' runs MoodleScraper/materials/moodle_autologin.py --print (RUNI, no Duo)
extension/runi.html   "Logging in…" page shown while that runs
~/Library/Mobile Documents/com~apple~CloudDocs/AutoLogin/logins.json.age
                      {host: record}, age-encrypted (iCloud Drive/AutoLogin)
install.sh            writes the host registration (run once per Mac, and after moving the folder)
~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.roykisluk.autologin.json
                      registers host.py for extension ID nifjbhcjkndmghlhinopidbnbjoehbjm.
                      Brave reads it from CHROME's folder, not BraveSoftware/… (see lesson log)
```

## Rules
- No secret ever goes in this folder or through chat.
- Storage: `logins.json.age` = `{host: {"fields": {css selector: value}, "submit": css selector|null}}`.
  The age X25519 key is the Keychain generic password service `autologin`, account `age-key`;
  host.py hands it to age via a pipe (`-i /dev/fd/N`), never argv or disk. `host == 'age-key'`
  is refused so a page can't fetch the key through the migration path.
- Key backup / new Mac: copy out with
  `security find-generic-password -s autologin -a age-key -w | pbcopy` (real Terminal, then
  `pbcopy </dev/null`); restore with
  `security add-generic-password -s autologin -a age-key -T /usr/bin/security -w` (prompts; paste).
  Without the key the iCloud file is unreadable — never regenerate it while the file exists.
- `AUTOLOGIN_STORE` env var overrides the file path, for tests only.
- Extension is loaded unpacked (brave://extensions → Developer mode → Load unpacked →
  `extension/`). Its ID comes from the folder path: **moving the folder changes the ID**
  and breaks `allowed_origins` in the host JSON — rerun `install.sh`. Unpacked ID = sha256(abs path)[:32] mapped 0-f → a-p.
- "Never" list (sites never to offer saving for) is in the extension's `chrome.storage.local`.

## How it decides
- Login fields = visible text/email/tel/number/password inputs in the password field's
  `<form>`, or the whole page if there is no form (TAU). Selector = `#id`, else `tag[name=…]`;
  fields with neither are skipped.
- Capture on a trusted click on a button or Enter in an input; the pending login sits in
  `chrome.storage.session` (memory only) for ≤5 min and the bar shows on the next page in that
  tab (or the same page after 3 s). No offer if it equals what is already saved.
- Autofill: always fills; auto-submits at most once per site per minute (`chrome.storage.local`),
  so a wrong saved password can't loop and lock an account (inside the minute: fill only); skipped while a 2FA (`autocomplete=one-time-code`) field is visible; only when
  every saved field is on the page. Its own click is untrusted, so it never re-captures itself.

## Known limits
- Two-step logins (username page, then password page): only the password page is saved/filled.
- Fields with no id and no name can't be saved.
- Whole-file rewrite with no lock: two saves in the same instant could lose one.
- If iCloud evicts the file ("Optimize Mac Storage"), host.py runs `brctl download` and waits
  ≤20 s. Untested: whether macOS asks Brave for iCloud Drive access the first time.
- iCloud Passwords can't be read or written by a script (`security` only sees the login
  keychain; the iCloud keychain needs an Apple-entitled signed app).

## Lesson log
- 2026-10-21 — Started as a Safari userscript relying on Safari Passwords autofill; Roy
  switched to Brave. Dropped "password manager fills, script clicks": TAU's form has 3 fields
  (user, ID number, password) that no password manager fills, the inputs sit outside the hidden
  `IDPLogin` form and the page posts via jQuery.ajax, and Chromium withholds autofilled
  passwords from page JS until a real user gesture. → Fill from Keychain instead.
- 2026-10-21 — Widened from a hardcoded TAU entry to every site with save-on-login (Roy's pick
  over "known sites only"). TAU's Terminal-command items were never created, so no migration.
- 2026-10-21 — Tests: host.py set/get round trip with a dummy site (password with quotes, `;`,
  `$()`), bad host rejected, dummy deleted. On the live TAU page (network stubbed, chrome.* shimmed,
  devtools trusted typing/clicks): capture recorded exactly #Ecom_User_ID/#Ecom_User_Pid/
  #Ecom_Password + #loginButton; autofill put saved values into TAU's jQuery.ajax body, showed the
  bar, set the cooldown, and did not re-capture its own click. **Not tested:** bg.js and the
  loaded extension end-to-end, and whether Brave's ID matches the computed one.
- 2026-10-21 — Claude Code's auto-mode classifier blocks writing the nativeMessaging manifest
  and host as "Unauthorized Persistence"; it went through after Roy explicitly approved.
- 2026-10-21 — Moved storage from one Keychain item per site to one age-encrypted file in iCloud
  Drive (Roy wanted an iCloud backup; the Keychain can't sync to iCloud from a script). Key made
  with `age-keygen | … | security -i add-generic-password -X <hex>` so it never hit the screen or
  argv; no `-U`, so it can't overwrite an existing key. `age -e -i <identity>` encrypts to the
  identity's own recipient, so only the one secret is needed. Tests: scratch-path round trip,
  file starts with `age-encryption.org` and has no plaintext, migration from a per-site Keychain
  item (old item deleted, other entries kept), `age-key` refused as a host; one round trip at the
  real iCloud path (test file deleted). The classifier blocked `security dump-keychain` as
  credential exploration — check single items by name instead.
- 2026-10-21 — Saves never reached iCloud in Brave. Symptom: no helper log at all, even via a
  logging launcher outside ~/Downloads; extension console (after adding a log line) said
  "Specified native messaging host not found." Registration in
  `~/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/` was valid and
  identical in shape to the Claude extension's. Root cause: this Brave build reads user-level hosts
  from `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`; a copy there made the
  helper launch at once. Fix: `install.sh` writes only there. Also moved the project from
  ~/Downloads/Roybox/Tools to ~/AutoLogin (Roy's call) — the ID changed with the path.
  Debug tools kept: content.js console-logs helper errors; host.py logs every call (op + host +
  outcome, never values) to ~/Library/Logs/autologin.log. Claude in Chrome must be switched to
  Brave (`switch_browser`) to test there; it cannot open brave:// pages.
- 2026-10-21 — Autofilled TAU but didn't submit. Root cause: Roy logged in with Enter, so the saved
  record had `submit: null`, and TAU's inputs have no `<form>` to `requestSubmit()`. Fix: capture via
  Enter records the default button (first visible submit-like button in the form/page); fill falls
  back saved button → default button → form.requestSubmit() → synthetic Enter on the password field.
  Tested on live TAU (stubbed): null-submit record pressed #loginButton; Enter capture saved
  #loginButton. Note: chrome-devtools MCP `sourcePath` only reads files under the Roybox workspace —
  copy content.js there temporarily to inject it.
- 2026-10-21 — "Doesn't work at all" right after the submit fix. Log showed every `get` returning
  `found`; root cause was the 10-min cooldown from the 09:08 autofill, which skipped *filling* too.
  Fix: cooldown now gates only the submit, and is 1 min (a wrong-password loop resubmits within
  seconds, so a minute stops it). Tested on live TAU (stubbed): 30 s after a submit → filled, nothing
  sent; 61 s → filled + submitted + cooldown renewed. Lesson: check the log before suspecting code —
  `found` + no fill = content-side gate.
- 2026-11-12 — RUNI Moodle without Duo. RUNI Moodle shows no login page of its own: with no session
  it 303s straight to `auth.runi.ac.il/saml/idp/...?RelayState=<moodle url>`, then F5/Duo, so a
  content script can't catch it. bg.js now watches that request (`webRequest`, observe only), switches
  the tab to runi.html before Duo loads, and host.py's `moodle` op returns a one-time autologin URL
  from the Moodle app token (see MoodleScraper `moodle_autologin.py`; one key per ~6 min). On failure
  the original SSO URL loads and RUNI is skipped for 1 min, so it can't loop. Switching away early also
  stops this extension's own my.runi.ac.il autofill from sending a Duo push. Tested: host op with a real
  native message (URL returned in ~1 s, non-RUNI url refused). **Not tested:** the loaded extension
  end to end (needs reload in brave://extensions, then open Moodle with an expired session).
