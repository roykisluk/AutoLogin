#!/usr/bin/python3
"""Native messaging host: keeps all login records in one age-encrypted file in iCloud Drive.

Messages: {"op": "get", "host": h} -> {"record": {...}} or {}
          {"op": "set", "host": h, "record": {...}} -> {"ok": true}
A record is {"fields": {css selector: value}, "submit": css selector or null}.
The file holds {host: record}. Its age key lives only in the login Keychain
(service "autologin", account "age-key") and reaches age through a pipe, never argv or disk.
"""
import json, os, struct, subprocess, sys, time
from pathlib import Path

SERVICE = 'autologin'
STORE = Path(os.environ.get('AUTOLOGIN_STORE',  # override is for tests only
             Path.home() / 'Library/Mobile Documents/com~apple~CloudDocs/AutoLogin/logins.json.age'))
AGE = '/opt/homebrew/bin/age'  # Brave starts us with a bare PATH
LOG = Path.home() / 'Library/Logs/autologin.log'


def keychain(account):
    r = subprocess.run(['/usr/bin/security', 'find-generic-password', '-s', SERVICE, '-a', account, '-w'],
                       capture_output=True, text=True)
    return r.stdout.rstrip('\n') if r.returncode == 0 else None


def age(args, data):
    key = keychain('age-key')
    if not key:
        raise RuntimeError('no age key in Keychain (autologin / age-key)')
    rfd, wfd = os.pipe()
    os.write(wfd, (key + '\n').encode())
    os.close(wfd)
    try:
        p = subprocess.run([AGE, '-i', f'/dev/fd/{rfd}', *args], input=data, capture_output=True, pass_fds=(rfd,))
    finally:
        os.close(rfd)
    if p.returncode:
        raise RuntimeError(p.stderr.decode().strip())
    return p.stdout


def load():
    if not STORE.exists():
        # iCloud "Optimize Mac Storage" may have evicted it, leaving a .<name>.icloud placeholder.
        if not STORE.with_name(f'.{STORE.name}.icloud').exists():
            return {}
        subprocess.run(['/usr/bin/brctl', 'download', str(STORE)], capture_output=True)
        for _ in range(40):
            if STORE.exists():
                break
            time.sleep(0.5)
        else:
            raise RuntimeError('iCloud did not download ' + STORE.name)
    return json.loads(age(['-d', str(STORE)], b''))


def save(logins):
    # ponytail: whole-file rewrite, no lock; two saves in the same instant could lose one.
    STORE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STORE.with_name('.' + STORE.name + '.tmp')
    tmp.write_bytes(age(['-e'], json.dumps(logins).encode()))
    os.replace(tmp, STORE)


def get(host):
    logins = load()
    if host not in logins:
        old = keychain(host)  # one-time migration from the per-site Keychain items of the first version
        if old:
            logins[host] = json.loads(old)
            save(logins)
            subprocess.run(['/usr/bin/security', 'delete-generic-password', '-s', SERVICE, '-a', host],
                           capture_output=True)
    return logins.get(host)


def main():
    n = struct.unpack('=I', sys.stdin.buffer.read(4))[0]
    msg = json.loads(sys.stdin.buffer.read(n))
    host = msg['host']
    try:
        if not host.replace('.', '').replace('-', '').replace(':', '').isalnum() or host == 'age-key':
            out = {'error': 'bad host'}
        elif msg['op'] == 'get':
            rec = get(host)
            out = {'record': rec} if rec else {}
        elif msg['op'] == 'set':
            logins = load()
            logins[host] = msg['record']
            save(logins)
            out = {'ok': True}
        else:
            out = {'error': 'bad op'}
    except Exception as e:  # anything uncaught would leave Brave with no reply and no clue
        out = {'error': f'{type(e).__name__}: {e}'}
    with open(LOG, 'a') as f:  # op + host + outcome only, never record contents
        f.write(f"{time.strftime('%F %T')} {msg.get('op')} {host}: {out.get('error') or ('found' if out else 'none')}\n")
    data = json.dumps(out).encode()
    sys.stdout.buffer.write(struct.pack('=I', len(data)) + data)
    sys.stdout.buffer.flush()


if __name__ == '__main__':
    main()
