import { useEffect, useState } from 'react';
import { Eye, EyeOff, Globe, Sparkles } from 'lucide-react';
import type { SupportedLanguage } from '@askmink/shared';
import { apiRequest } from '@/lib/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface AuthScreenProps {
  lang: SupportedLanguage;
  onChangeLang: (lang: SupportedLanguage) => void;
  t: Record<string, string>;
  onAuthenticated: (user: any) => void;
}

function resolveAuthModeFromLocation(): 'login' | 'signup' {
  if (typeof window === 'undefined') return 'login';
  const seg = window.location.pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
  return seg === 'signup' ? 'signup' : 'login';
}

export function AuthScreen({ lang, onChangeLang, t, onAuthenticated }: AuthScreenProps) {
  const [mode, setMode] = useState<'login' | 'signup'>(resolveAuthModeFromLocation);
  const [name, setName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const expectedPath = `/${mode}`;
    if (window.location.pathname !== expectedPath) {
      window.history.replaceState({ authMode: mode }, '', expectedPath);
    }
    function onPopState() {
      setMode(resolveAuthModeFromLocation());
      setShowPassword(false);
      setError('');
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

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
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <Card className="w-full max-w-md rounded-2xl shadow-sm overflow-hidden">
        <div className="mesh-banner p-6 border-b border-border">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className="size-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shadow-sm shrink-0"
                aria-hidden="true"
              >
                <Sparkles className="size-5" />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-foreground tracking-tight">Askmink</h1>
                <p className="text-xs text-foreground/75">{t.authSubtitle}</p>
              </div>
            </div>

            <div
              className="inline-flex items-center gap-1 p-1 rounded-xl bg-white/95 border border-border/80 shadow-xs shrink-0"
              role="group"
              aria-label={t.language}
            >
              <Globe className="size-3.5 text-slate-600 ml-1.5 mr-0.5" aria-hidden="true" />
              {(['en', 'pt', 'es'] as SupportedLanguage[]).map((code) => (
                <Button
                  key={code}
                  type="button"
                  size="xs"
                  variant={lang === code ? 'default' : 'ghost'}
                  onClick={() => onChangeLang(code)}
                  aria-pressed={lang === code}
                  className={
                    lang === code
                      ? 'h-6 px-2.5 text-[11px] font-semibold uppercase rounded-lg bg-primary text-primary-foreground shadow-xs hover:bg-primary/90'
                      : 'h-6 px-2.5 text-[11px] font-semibold uppercase rounded-lg text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                  }
                >
                  {code}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <CardContent className="p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <Tabs
              value={mode}
              onValueChange={(v) => {
                const next = v === 'signup' ? 'signup' : 'login';
                setMode(next);
                setShowPassword(false);
                setError('');
                if (typeof window !== 'undefined') {
                  window.history.replaceState({ authMode: next }, '', `/${next}`);
                }
              }}
            >
              <TabsList className="w-full">
                <TabsTrigger value="login">{t.signIn}</TabsTrigger>
                <TabsTrigger value="signup">{t.signUp}</TabsTrigger>
              </TabsList>
            </Tabs>

            {mode === 'signup' && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="auth-name">{t.authFullName}</Label>
                  <Input
                    id="auth-name"
                    name="name"
                    autoComplete="name"
                    className="h-9 text-sm"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    minLength={2}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="auth-workspace">{t.authWorkspaceName}</Label>
                  <Input
                    id="auth-workspace"
                    name="workspaceName"
                    autoComplete="organization"
                    className="h-9 text-sm"
                    placeholder={t.authWorkspacePh}
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                  />
                </div>
              </>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="auth-email">{t.authEmail}</Label>
              <Input
                id="auth-email"
                name="email"
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                className="h-9 text-sm"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="auth-password">
                {t.authPassword}{' '}
                {mode === 'signup' && (
                  <span className="text-muted-foreground font-normal">{t.authMinChars}</span>
                )}
              </Label>
              <div className="relative">
                <Input
                  id="auth-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  className="h-9 text-sm pr-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={mode === 'signup' ? 8 : 1}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? t.hidePassword || 'Hide password' : t.showPassword || 'Show password'}
                  aria-pressed={showPassword}
                  aria-controls="auth-password"
                  className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? (
                    <EyeOff className="size-4" aria-hidden="true" />
                  ) : (
                    <Eye className="size-4" aria-hidden="true" />
                  )}
                </Button>
              </div>
            </div>

            {error && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" size="lg" disabled={busy} className="w-full">
              {busy ? t.authPleaseWait : mode === 'signup' ? t.authCreateWorkspace : t.signIn}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
