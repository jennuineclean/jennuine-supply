import { useState } from 'react';
import { supabase } from '../supabaseClient';

export default function Login() {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    setErr('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
    if (error) setErr(error.message);
    setBusy(false);
  }

  return (
    <div className="login">
      <div className="login-card">
        <div className="wordmark"><h1>Jennuine Clean</h1><span className="tag">Supply Room</span></div>
        <p className="login-sub">Sign in to your supply room.</p>
        <div className="field"><label>Email</label>
          <input type="email" value={email} autoComplete="username"
            onChange={e => setEmail(e.target.value)} placeholder="you@jennuineclean.com" />
        </div>
        <div className="field"><label>Password</label>
          <input type="password" value={pw} autoComplete="current-password"
            onChange={e => setPw(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && signIn()} placeholder="••••••••" />
        </div>
        {err && <div className="login-err">{err}</div>}
        <button className="btn btn-sage" style={{ width: '100%', marginTop: 6 }} disabled={busy} onClick={signIn}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </div>
    </div>
  );
}
