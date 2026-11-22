import { useState } from 'react';
import { Globe, Sparkles } from 'lucide-react';
import type { SupportedLanguage } from '@askmink/shared';
import { apiRequest } from '../lib/api';

interface AuthScreenProps {
  lang: SupportedLanguage;
  onChangeLang: (lang: SupportedLanguage) => void;
  t: Record<string, string>;
  onAuthenticated: (user: any) => void;
}

export function AuthScreen({ lang, onChangeLang, t, onAuthenticated }: AuthScreenProps) {
  const [mode, setMode] = useState<'login' | 'signup'>('signup');
  const [name, setName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const endpoint = mode === 'signup' ? '/api/auth/signup' : '/api/auth/login';
      const payload =
        mode === 'signup'
          ? { name, email, password, workspaceName: workspaceName || undefined }
          : { email, password };
      const res = await apiRequest<{ user: any }>(endpoint, { method: 'POST', body: payload });
      onAuthenticated(res.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F8F9FB] flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md bg-white border border-[#EAECEF] rounded-2xl shadow-sm overflow-hidden">
        <div className="mesh-banner p-6 border-b border-[#EAECEF]">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl bg-[#18181B] text-white flex items-center justify-center shadow-sm shrink-0"
                aria-hidden="true"
              >
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-[#111827]">Askmink</h1>
                <p className="text-xs text-[#6B7280]">{t.authSubtitle}</p>
              </div>
            </div>

            <div
              className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-white/80 border border-[#EAECEF] shrink-0"
              role="group"
              aria-label={t.language}
            >
              <Globe className="w-3 h-3 text-[#6B7280] ml-1 mr-0.5" aria-hidden="true" />
              {(['en', 'pt', 'es'] as SupportedLanguage[]).map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => onChangeLang(code)}
                  aria-pressed={lang === code}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase transition ${
                    lang === code
                      ? 'bg-[#18181B] text-white'
                      : 'text-[#6B7280] hover:text-[#111827]'
                  }`}
                >
                  {code}
                </button>
              ))}
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="flex rounded-lg bg-[#F3F4F6] p-1 text-xs font-medium">
            <button
              type="button"
              onClick={() => setMode('login')}
              className={`flex-1 py-1.5 rounded-md transition ${
                mode === 'login' ? 'bg-white text-[#111827] shadow-xs' : 'text-[#6B7280]'
              }`}
            >
              {t.signIn}
            </button>
            <button
              type="button"
              onClick={() => setMode('signup')}
              className={`flex-1 py-1.5 rounded-md transition ${
                mode === 'signup' ? 'bg-white text-[#111827] shadow-xs' : 'text-[#6B7280]'
              }`}
            >
              {t.signUp}
            </button>
          </div>

          {mode === 'signup' && (
            <>
              <div>
                <label htmlFor="auth-name" className="block text-xs font-medium text-[#374151] mb-1">
                  {t.authFullName}
                </label>
                <input
                  id="auth-name"
                  autoComplete="name"
                  className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  minLength={2}
                />
              </div>
              <div>
                <label
                  htmlFor="auth-workspace"
                  className="block text-xs font-medium text-[#374151] mb-1"
                >
                  {t.authWorkspaceName}
                </label>
                <input
                  id="auth-workspace"
                  autoComplete="organization"
                  className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg"
                  placeholder={t.authWorkspacePh}
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                />
              </div>
            </>
          )}

          <div>
            <label htmlFor="auth-email" className="block text-xs font-medium text-[#374151] mb-1">
              {t.authEmail}
            </label>
            <input
              id="auth-email"
              type="email"
              autoComplete="email"
              className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div>
            <label
              htmlFor="auth-password"
              className="block text-xs font-medium text-[#374151] mb-1"
            >
              {t.authPassword}{' '}
              {mode === 'signup' && <span className="text-[#9CA3AF]">{t.authMinChars}</span>}
            </label>
            <input
              id="auth-password"
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === 'signup' ? 8 : 1}
            />
          </div>

          {error && (
            <div
              role="alert"
              className="text-xs text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded-lg px-3 py-2"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full py-2.5 rounded-lg bg-[#18181B] text-white text-sm font-medium hover:bg-[#27272A] transition disabled:opacity-60"
          >
            {busy ? t.authPleaseWait : mode === 'signup' ? t.authCreateWorkspace : t.signIn}
          </button>
        </form>
      </div>
    </div>
  );
}
