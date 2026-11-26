export const WIDGET_CSS = `
:host {
  all: initial;
  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #111827;
  font-size: 14px;
  line-height: 1.45;
}
* { box-sizing: border-box; }
.am-root {
  --am-primary: #2563EB;
  --am-radius-panel: 18px;
  --am-radius-launcher: 9999px;
  --am-radius-bubble: 14px;
  --am-radius-btn: 10px;
  --am-bg: #FFFFFF;
  --am-bg-muted: #F8F9FB;
  --am-border: #EAECEF;
  --am-text: #111827;
  --am-text-muted: #6B7280;
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 2147483000;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 12px;
}
.am-root[data-position="bottom-left"] {
  right: auto;
  left: 20px;
  align-items: flex-start;
}
.am-root[data-radius="classic"] {
  --am-radius-panel: 12px;
  --am-radius-launcher: 12px;
  --am-radius-bubble: 10px;
  --am-radius-btn: 8px;
}
.am-root[data-radius="sharp"] {
  --am-radius-panel: 6px;
  --am-radius-launcher: 6px;
  --am-radius-bubble: 6px;
  --am-radius-btn: 5px;
}
.am-root[data-theme="dark"] {
  --am-bg: #18181B;
  --am-bg-muted: #0B0F19;
  --am-border: #27272A;
  --am-text: #F9FAFB;
  --am-text-muted: #9CA3AF;
}
.am-launcher {
  min-width: 52px;
  height: 52px;
  padding: 0 14px;
  border-radius: var(--am-radius-launcher);
  border: 1px solid rgba(17,24,39,0.08);
  background: var(--am-primary);
  color: #FFFFFF;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 10px 25px rgba(15, 23, 42, 0.2);
  transition: transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease;
}
.am-launcher-icon {
  width: 52px;
  padding: 0;
}
.am-launcher:hover { transform: translateY(-2px); filter: brightness(1.06); box-shadow: 0 14px 30px rgba(15, 23, 42, 0.25); }
.am-panel {
  width: min(390px, calc(100vw - 24px));
  height: min(600px, calc(100vh - 100px));
  background: var(--am-bg);
  color: var(--am-text);
  border: 1px solid var(--am-border);
  border-radius: var(--am-radius-panel);
  box-shadow: 0 20px 50px rgba(15, 23, 42, 0.22);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.am-header {
  padding: 14px 16px;
  border-bottom: 1px solid var(--am-border);
  background: var(--am-bg);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.am-brand {
  display: flex;
  align-items: center;
  gap: 10px;
}
.am-avatar {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: var(--am-primary);
  color: #FFF;
  font-weight: 700;
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.am-title { font-weight: 600; font-size: 14px; color: var(--am-text); margin: 0; }
.am-status { font-size: 11px; color: #16A34A; display: flex; align-items: center; gap: 5px; }
.am-dot { width: 7px; height: 7px; border-radius: 999px; background: #16A34A; display: inline-block; }
.am-close {
  border: 1px solid var(--am-border);
  background: transparent;
  color: var(--am-text-muted);
  width: 28px;
  height: 28px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
}
.am-messages {
  flex: 1;
  overflow-y: auto;
  padding: 14px;
  background: var(--am-bg-muted);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.am-msg {
  max-width: 88%;
  padding: 10px 12px;
  border-radius: var(--am-radius-bubble);
  font-size: 13.5px;
  word-break: break-word;
}
.am-user-text {
  white-space: pre-wrap;
}
.am-msg-user {
  align-self: flex-end;
  background: var(--am-primary);
  color: #FFFFFF;
  border-bottom-right-radius: 4px;
}
.am-msg-bot {
  align-self: flex-start;
  background: var(--am-bg);
  color: var(--am-text);
  border: 1px solid var(--am-border);
  border-bottom-left-radius: 4px;
}
.am-citations {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.am-cite {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 999px;
  background: #EFF6FF;
  color: #1D4ED8;
  text-decoration: none;
  border: 1px solid #DBEAFE;
}
.am-root[data-theme="dark"] .am-cite {
  background: #1E293B;
  color: #93C5FD;
  border-color: #334155;
}
.am-card {
  margin-top: 8px;
  background: var(--am-bg-muted);
  border: 1px solid var(--am-border);
  border-radius: 12px;
  padding: 12px;
  width: 100%;
  box-shadow: 0 1px 2px rgba(0,0,0,0.03);
}
.am-card-title { font-weight: 600; font-size: 13px; color: var(--am-text); margin: 0 0 4px; }
.am-card-desc { font-size: 12px; color: var(--am-text-muted); margin: 0 0 8px; }
.am-price { font-weight: 700; font-size: 15px; color: var(--am-text); margin-bottom: 8px; font-variant-numeric: tabular-nums; }
.am-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 12px;
  border-radius: var(--am-radius-btn);
  border: none;
  background: var(--am-primary);
  color: #FFFFFF;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  text-decoration: none;
}
.am-btn-sec {
  background: transparent;
  color: var(--am-text);
  border: 1px solid var(--am-border);
}
.am-slots {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin: 8px 0;
}
.am-slot {
  padding: 6px 8px;
  font-size: 11.5px;
  border-radius: 8px;
  border: 1px solid var(--am-border);
  background: var(--am-bg);
  color: var(--am-text);
  cursor: pointer;
  text-align: left;
}
.am-slot-active {
  border-color: var(--am-primary);
  color: var(--am-primary);
  font-weight: 600;
}
.am-input {
  width: 100%;
  padding: 7px 10px;
  border: 1px solid var(--am-border);
  background: var(--am-bg);
  color: var(--am-text);
  border-radius: 8px;
  font-size: 12.5px;
  margin-bottom: 6px;
  outline: none;
}
.am-input:focus { border-color: var(--am-primary); }
.am-badge {
  display: inline-block;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  font-weight: 500;
}
.am-badge-ok { background: #DCFCE7; color: #15803D; }
.am-badge-warn { background: #FEF3C7; color: #B45309; }
.am-badge-err { background: #FEE2E2; color: #B91C1C; }
.am-form {
  padding: 10px 12px;
  border-top: 1px solid var(--am-border);
  background: var(--am-bg);
  display: flex;
  gap: 8px;
}
.am-composer {
  flex: 1;
  border: 1px solid var(--am-border);
  background: var(--am-bg-muted);
  color: var(--am-text);
  border-radius: 10px;
  padding: 8px 11px;
  font-size: 13.5px;
  outline: none;
}
.am-composer:focus { border-color: var(--am-primary); }
.am-footer {
  padding: 5px 12px 7px;
  text-align: center;
  font-size: 11px;
  color: var(--am-text-muted);
  background: var(--am-bg);
}
.am-md {
  white-space: normal;
}
.am-md p {
  margin: 0 0 6px;
}
.am-md p:last-child {
  margin-bottom: 0;
}
.am-md ul,
.am-md ol {
  margin: 4px 0 6px;
  padding-left: 18px;
}
.am-md ul:last-child,
.am-md ol:last-child {
  margin-bottom: 0;
}
.am-md li {
  margin: 2px 0;
}
.am-md strong {
  font-weight: 600;
}
.am-md em {
  font-style: italic;
}
.am-md code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  padding: 1px 5px;
  border-radius: 5px;
  background: var(--am-bg-muted);
  border: 1px solid var(--am-border);
}
.am-md a {
  color: var(--am-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
  word-break: break-all;
}
.am-root[data-theme="dark"] .am-md a {
  color: #93C5FD;
}
.am-starters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-top: 2px;
}
.am-starter {
  font: inherit;
  font-size: 12px;
  line-height: 1.3;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid var(--am-border);
  background: var(--am-bg);
  color: var(--am-text);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s ease, color 0.15s ease;
}
.am-starter:hover {
  border-color: var(--am-primary);
  color: var(--am-primary);
}
.am-thinking {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--am-text-muted);
}
.am-dots {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.am-dots span {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: currentColor;
  opacity: 0.4;
  animation: am-pulse 1.2s infinite ease-in-out;
}
.am-dots span:nth-child(2) {
  animation-delay: 0.2s;
}
.am-dots span:nth-child(3) {
  animation-delay: 0.4s;
}
@keyframes am-pulse {
  0%, 80%, 100% { opacity: 0.3; transform: scale(0.85); }
  40% { opacity: 1; transform: scale(1); }
}
`;
