import { useState } from 'react';
import { Globe, Sparkles } from 'lucide-react';
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
                <p className="text-xs text-muted-foreground">{t.authSubtitle}</p>
              </div>
            </div>

            <div
              className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-background/80 border border-border shrink-0"
              role="group"
              aria-label={t.language}
            >
              <Globe className="size-3 text-muted-foreground ml-1 mr-0.5" aria-hidden="true" />
              {(['en', 'pt', 'es'] as SupportedLanguage[]).map((code) => (
                <Button
                  key={code}
                  type="button"
                  size="xs"
                  variant={lang === code ? 'default' : 'ghost'}
                  onClick={() => onChangeLang(code)}
                  aria-pressed={lang === code}
                  className="h-5 px-1.5 text-[10px] font-semibold uppercase"
                >
                  {code}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <CardContent className="p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <Tabs value={mode} onValueChange={(v) => setMode(v as 'login' | 'signup')}>
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
                type="email"
                autoComplete="email"
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
              <Input
                id="auth-password"
                type="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                className="h-9 text-sm"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={mode === 'signup' ? 8 : 1}
              />
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
