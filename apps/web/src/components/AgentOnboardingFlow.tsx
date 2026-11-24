import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Globe, LogOut, Sparkles } from 'lucide-react';
import type { SupportedLanguage } from '@askmink/shared';
import { apiRequest } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface AgentOnboardingFlowProps {
  mode: 'first-agent' | 'new-agent';
  open?: boolean;
  user?: any;
  lang: SupportedLanguage;
  onChangeLang?: (lang: SupportedLanguage) => void;
  onLogout?: () => void;
  t: Record<string, string>;
  onClose?: () => void;
  onCreated: (agent: any) => Promise<void> | void;
}

const DEFAULT_WELCOME_BY_LANG: Record<SupportedLanguage, string> = {
  pt: 'Olá! Como posso ajudar você hoje?',
  en: 'Hi! How can I help you today?',
  es: '¡Hola! ¿Cómo puedo ayudarte hoy?',
};

export function AgentOnboardingFlow({
  mode,
  open = true,
  user,
  lang,
  onChangeLang,
  onLogout,
  t,
  onClose,
  onCreated,
}: AgentOnboardingFlowProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [nameInvalid, setNameInvalid] = useState(false);

  const nameInputRef = useRef<HTMLInputElement>(null);
  const isVisible = mode === 'first-agent' || open;

  useEffect(() => {
    if (!isVisible) return;
    setName('');
    setDescription('');
    setError('');
    setNameInvalid(false);
  }, [isVisible]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (creating) return;

    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      setNameInvalid(true);
      setError(t.onboardingNameError || 'Enter at least 2 characters for the agent name.');
      nameInputRef.current?.focus();
      return;
    }

    setCreating(true);
    setError('');
    setNameInvalid(false);

    try {
      const res = await apiRequest<{ item: any }>('/api/agents', {
        method: 'POST',
        body: {
          name: trimmedName,
          description: description.trim(),
          defaultLanguage: lang,
          welcomeMessage: DEFAULT_WELCOME_BY_LANG[lang],
        },
      });

      await onCreated(res.item);
      onClose?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  const formFields = (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="onb-agent-name">{t.agentNameLabel}</Label>
        <Input
          ref={nameInputRef}
          id="onb-agent-name"
          name="agent_name"
          type="text"
          autoFocus
          required
          minLength={2}
          maxLength={100}
          aria-invalid={nameInvalid || undefined}
          enterKeyHint="next"
          placeholder={t.onboardingAgentNamePh || 'e.g. Support Assistant'}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (nameInvalid && e.target.value.trim().length >= 2) {
              setNameInvalid(false);
              setError('');
            }
          }}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="onb-agent-desc" className="flex items-center gap-1.5">
          <span>{t.agentDescLabel}</span>
          <span className="text-xs font-normal text-muted-foreground">
            ({t.onboardingDescOptional || 'optional'})
          </span>
        </Label>
        <Textarea
          id="onb-agent-desc"
          name="agent_description"
          rows={3}
          maxLength={500}
          placeholder={t.onboardingDescPh || 'Briefly note what this agent will handle...'}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        {mode === 'new-agent' && onClose && (
          <Button type="button" variant="ghost" onClick={onClose} disabled={creating}>
            {t.cancel}
          </Button>
        )}
        <Button
          type="submit"
          disabled={creating}
          className={cn(mode === 'first-agent' && 'w-full')}
        >
          <span>
            {creating
              ? t.wizardCreating
              : mode === 'first-agent'
                ? t.onboardingLaunchFirst
                : t.wizardCreate}
          </span>
          {!creating && <ArrowRight className="size-3.5" aria-hidden="true" />}
        </Button>
      </div>
    </form>
  );

  // MODE 1: Minimalist Full-Screen First-Agent Onboarding
  if (mode === 'first-agent') {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <header className="h-14 px-5 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <div
              className="size-7 rounded-lg bg-primary text-primary-foreground flex items-center justify-center"
              aria-hidden="true"
            >
              <Sparkles className="size-3.5" />
            </div>
            <span className="font-semibold text-sm text-foreground">Askmink</span>
          </div>

          <div className="flex items-center gap-2">
            {onChangeLang && (
              <div
                className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-muted/70 border border-border/70"
                role="group"
                aria-label={t.language}
              >
                <Globe className="size-3 text-muted-foreground ml-1.5 mr-0.5" aria-hidden="true" />
                {(['en', 'pt', 'es'] as SupportedLanguage[]).map((code) => (
                  <Button
                    key={code}
                    type="button"
                    size="xs"
                    variant={lang === code ? 'secondary' : 'ghost'}
                    onClick={() => onChangeLang(code)}
                    aria-pressed={lang === code}
                    className={cn(
                      'h-5 px-1.5 text-[10px] font-semibold uppercase',
                      lang === code && 'bg-background shadow-2xs text-foreground'
                    )}
                  >
                    {code}
                  </Button>
                ))}
              </div>
            )}
            {onLogout && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={onLogout}
                className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              >
                <LogOut className="size-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">{t.logout}</span>
              </Button>
            )}
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center px-5 py-10">
          <div className="w-full max-w-md space-y-6">
            <div className="space-y-1.5">
              {user?.name && (
                <p className="text-xs font-medium text-muted-foreground">
                  {t.onboardingWelcome}, {user.name}
                </p>
              )}
              <h1 className="text-2xl font-semibold text-foreground tracking-tight">
                {t.onboardingStep1Heading || 'Create your agent'}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t.onboardingStep1Hint || 'Give your agent a name to get started.'}
              </p>
            </div>

            <div className="rounded-2xl border border-border bg-card p-6 shadow-xs">
              {formFields}
            </div>
          </div>
        </main>
      </div>
    );
  }

  // MODE 2: Minimalist New Agent Modal Dialog
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose?.();
      }}
    >
      <DialogContent className="max-w-md p-6 gap-5 rounded-2xl">
        <DialogHeader>
          <DialogTitle>{t.wizardTitle}</DialogTitle>
          <DialogDescription>
            {t.onboardingStep1Hint || 'Give your agent a name to get started.'}
          </DialogDescription>
        </DialogHeader>
        {formFields}
      </DialogContent>
    </Dialog>
  );
}
