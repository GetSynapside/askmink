import { Fragment, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F]/;

function parseSafeHttpUrl(rawUrl: unknown): URL | null {
  if (typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.startsWith('//') || CONTROL_CHAR_RE.test(trimmed)) return null;
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.hostname.length > 0 &&
      !CONTROL_CHAR_RE.test(parsed.href)
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function isSafeHttpUrl(rawUrl: unknown): rawUrl is string {
  return parseSafeHttpUrl(rawUrl) !== null;
}

function parseInline(text: string, depth = 0): ReactNode[] {
  if (!text || depth > 6) return [text];
  const out: ReactNode[] = [];
  let buf = '';
  let i = 0;

  const flush = () => {
    if (buf) {
      out.push(buf);
      buf = '';
    }
  };

  while (i < text.length) {
    const ch = text[i];

    // 1. Inline code: `...`
    if (ch === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push(
          <code
            key={`c-${i}`}
            className="px-1.5 py-0.5 rounded bg-zinc-500/15 border border-current/15 font-mono text-[0.88em]"
          >
            {text.slice(i + 1, end)}
          </code>
        );
        i = end + 1;
        continue;
      }
    }

    // 2. Links: [label](url) with balanced parentheses in url
    if (ch === '[') {
      const closeBracket = text.indexOf(']', i + 1);
      if (closeBracket > i + 1 && text[closeBracket + 1] === '(') {
        let pDepth = 1;
        let j = closeBracket + 2;
        while (j < text.length && pDepth > 0) {
          const uc = text[j];
          if (uc === '\n') break;
          if (uc === '(') pDepth++;
          else if (uc === ')') pDepth--;
          j++;
        }
        if (pDepth === 0) {
          const label = text.slice(i + 1, closeBracket);
          const rawUrl = text.slice(closeBracket + 2, j - 1);
          flush();
          const parsedUrl = parseSafeHttpUrl(rawUrl);
          if (parsedUrl) {
            out.push(
              <a
                key={`a-${i}`}
                href={parsedUrl.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 underline underline-offset-2 hover:text-blue-500 break-all"
              >
                {parseInline(label, depth + 1)}
              </a>
            );
          } else {
            out.push(
              <Fragment key={`bl-${i}`}>{parseInline(label, depth + 1)}</Fragment>
            );
          }
          i = j;
          continue;
        }
      }
    }

    // 3. Bold + Italic: ***...***
    if (ch === '*' && text[i + 1] === '*' && text[i + 2] === '*') {
      const nextCh = text[i + 3];
      if (nextCh && !/\s/.test(nextCh)) {
        let end = text.indexOf('***', i + 3);
        while (end !== -1 && /\s/.test(text[end - 1] || '')) {
          end = text.indexOf('***', end + 1);
        }
        if (end > i + 3) {
          flush();
          out.push(
            <strong key={`bi-${i}`} className="font-semibold">
              <em>{parseInline(text.slice(i + 3, end), depth + 1)}</em>
            </strong>
          );
          i = end + 3;
          continue;
        }
      }
    }

    // 4. Bold: **...**
    if (ch === '*' && text[i + 1] === '*') {
      const nextCh = text[i + 2];
      if (nextCh && !/\s/.test(nextCh)) {
        let end = text.indexOf('**', i + 2);
        while (end !== -1 && /\s/.test(text[end - 1] || '')) {
          end = text.indexOf('**', end + 1);
        }
        if (end > i + 2) {
          if (
            text[end + 2] === '*' &&
            (end + 3 >= text.length || /\s|[.,!?;:)\]]/.test(text[end + 3] || ''))
          ) {
            end++;
          }
          flush();
          out.push(
            <strong key={`b-${i}`} className="font-semibold">
              {parseInline(text.slice(i + 2, end), depth + 1)}
            </strong>
          );
          i = end + 2;
          continue;
        }
      }
    }

    // 5. Italic: *...*
    if (ch === '*' && text[i - 1] !== '*' && text[i + 1] !== '*') {
      const nextCh = text[i + 1];
      if (nextCh && !/\s/.test(nextCh)) {
        let end = i + 2;
        let found = -1;
        while (end < text.length) {
          if (
            text[end] === '*' &&
            text[end - 1] !== '*' &&
            text[end + 1] !== '*' &&
            !/\s/.test(text[end - 1] || '')
          ) {
            found = end;
            break;
          }
          end++;
        }
        if (found > i + 1) {
          flush();
          out.push(<em key={`e-${i}`}>{parseInline(text.slice(i + 1, found), depth + 1)}</em>);
          i = found + 1;
          continue;
        }
      }
    }

    buf += ch ?? '';
    i++;
  }

  flush();
  return out;
}

export function SafeMarkdown({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const normalized = String(content ?? '').replace(/\r\n?/g, '\n');
  if (!normalized.trim()) {
    return null;
  }

  const lines = normalized.split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (!line.trim()) {
      i++;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i] ?? '')) {
        const itemText = (lines[i] ?? '').replace(/^\s*[-*]\s+/, '');
        items.push(<li key={items.length}>{parseInline(itemText)}</li>);
        i++;
      }
      blocks.push(
        <ul key={blocks.length} className="list-disc pl-5 space-y-0.5 my-1">
          {items}
        </ul>
      );
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i] ?? '')) {
        const itemText = (lines[i] ?? '').replace(/^\s*\d+\.\s+/, '');
        items.push(<li key={items.length}>{parseInline(itemText)}</li>);
        i++;
      }
      blocks.push(
        <ol key={blocks.length} className="list-decimal pl-5 space-y-0.5 my-1">
          {items}
        </ol>
      );
      continue;
    }

    const paraLines: string[] = [];
    while (i < lines.length) {
      const cur = lines[i] ?? '';
      if (!cur.trim() || /^\s*[-*]\s+/.test(cur) || /^\s*\d+\.\s+/.test(cur)) break;
      paraLines.push(cur);
      i++;
    }
    blocks.push(
      <p key={blocks.length} className="leading-relaxed">
        {paraLines.map((pl, idx) => (
          <Fragment key={`pl-${idx}`}>
            {idx > 0 && <br />}
            {parseInline(pl)}
          </Fragment>
        ))}
      </p>
    );
  }

  return <div className={cn('whitespace-normal break-words space-y-1.5', className)}>{blocks}</div>;
}
