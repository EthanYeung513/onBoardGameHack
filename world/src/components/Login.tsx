import { useState } from 'react';
import { COMPANY } from '../config';
import type { Hire } from '../App';

const GoogleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.1a7.16 7.16 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
);
const AppleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 384 512" fill="currentColor"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.5-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/></svg>
);

export default function Login({ onDone }: { onDone: (h: Hire) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [err, setErr] = useState('');

  const submit = (sso?: string) => {
    const n = name.trim();
    // The email is the hire's identity (their progress, saves and dashboard row), so SSO needs it too.
    const e = email.trim();
    if (!n) return setErr('Tell us your name first.');
    if (!e || !/^\S+@\S+\.\S+$/.test(e)) return setErr('Enter a valid email address.');
    onDone({ name: n, email: e, sso });
  };

  return (
    <div className="login-screen">
      <div className="login-panel">
        <div className="sd-panel login-card">
          <h2>Welcome, new hire</h2>
          <p className="sub">Log in to enter {COMPANY.name}</p>
          <label className="lbl">Your name</label>
          <input className="sd-field" value={name} placeholder="e.g. Sam Rivera"
            onChange={e => setName(e.target.value)} autoFocus />
          <label className="lbl">Work email</label>
          <input className="sd-field" type="email" value={email}
            placeholder={`you@${COMPANY.host}`}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()} />
          <div className="login-err">{err}</div>
          <button className="sd-btn" onClick={() => submit()}>Continue</button>
          <div className="login-divider">or</div>
          <button className="sso-btn" onClick={() => submit('google')}><GoogleIcon /> Continue with Google</button>
          <button className="sso-btn" onClick={() => submit('apple')}><AppleIcon /> Continue with Apple</button>
        </div>
      </div>
    </div>
  );
}
