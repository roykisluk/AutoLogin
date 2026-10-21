# AutoLogin

Brave extension that works like a tiny password manager on every https site: when you log in
by hand it offers to save what you typed; next time it fills and submits by itself. Logins are
stored in one age-encrypted file in iCloud Drive; its key is only in this Mac's login Keychain
(Roy keeps a copy of the key in the Apple Passwords app).

```
extension/content.js  runs on every https page with a password field: autofill, capture, save bar
extension/bg.js       relays to the native host; host name always from the sender URL
host.py               native messaging host: get/set records in the encrypted iCloud file
~/Library/Mobile Documents/com~apple~CloudDocs/AutoLogin/logins.json.age
                      {host: record}, age-encrypted (iCloud Drive/AutoLogin)
~/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/com.roykisluk.autologin.json
                      registers host.py for extension ID nifjbhcjkndmghlhinopidbnbjoehbjm
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
  and breaks `allowed_origins` in the host JSON. Unpacked ID = sha256(abs path)[:32] mapped 0-f → a-p.
- "Never" list (sites never to offer saving for) is in the extension's `chrome.storage.local`.

## How it decides
- Login fields = visible text/email/tel/number/password inputs in the password field's
  `<form>`, or the whole page if there is no form (TAU). Selector = `#id`, else `tag[name=…]`;
  fields with neither are skipped.
- Capture on a trusted click on a button or Enter in an input; the pending login sits in
  `chrome.storage.session` (memory only) for ≤5 min and the bar shows on the next page in that
  tab (or the same page after 3 s). No offer if it equals what is already saved.
- Autofill: once per site per 10 min (`chrome.storage.local`), so a wrong saved password can't
  lock an account; skipped while a 2FA (`autocomplete=one-time-code`) field is visible; only when
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
