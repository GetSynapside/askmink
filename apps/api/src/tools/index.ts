import { jwtVerify, SignJWT } from 'jose';
import type { HttpToolParam } from '@askmink/shared';
import { safeFetch } from '../security/ssrf.js';

export type VerifiedSessionClaims = Record<string, unknown>;

// Strictly verify widget visitor JWT with hardcoded HS256 (rejects alg:none and requires exp)
export async function verifyWidgetSessionJwt(
  token: string,
  secret: string
): Promise<VerifiedSessionClaims> {
  const secretBytes = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, secretBytes, {
    algorithms: ['HS256'],
    requiredClaims: ['exp'],
  });
  return payload as VerifiedSessionClaims;
}

export async function signWidgetSessionJwt(
  claims: Record<string, unknown>,
  secret: string,
  expiresIn = '1h'
): Promise<string> {
  const secretBytes = new TextEncoder().encode(secret);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secretBytes);
}

function getNestedClaim(claims: VerifiedSessionClaims, pathExpr: string): unknown {
  const parts = pathExpr.split('.');
  let current: unknown = claims;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

// Replaces {{session.claim}} templates strictly from verified JWT claims (never LLM input)
export function interpolateSessionTemplates(
  template: string,
  sessionClaims: VerifiedSessionClaims | null
): string {
  return template.replace(/\{\{\s*session\.([a-zA-Z0-9_.]+)\s*\}\}/g, (_match, claimPath: string) => {
    if (!sessionClaims) {
      throw new Error(`Tool requires verified session claim: session.${claimPath}`);
    }
    const val = getNestedClaim(sessionClaims, claimPath);
    if (val === undefined || val === null) {
      throw new Error(`Missing required JWT session claim: session.${claimPath}`);
    }
    return String(val);
  });
}

export interface HttpToolExecutionInput {
  method: string;
  url: string;
  headers: Record<string, string>;
  parameters: HttpToolParam[];
  llmArgs: Record<string, unknown>;
  sessionClaims: VerifiedSessionClaims | null;
  allowLoopbackForTest?: boolean;
}

export interface HttpToolExecutionResult {
  status: number;
  ok: boolean;
  data: unknown;
  rawBody: string;
  durationMs: number;
}

export async function executeHttpTool(
  input: HttpToolExecutionInput
): Promise<HttpToolExecutionResult> {
  const start = Date.now();

  // 1. Interpolate {{session.*}} in URL and headers strictly from verified JWT
  let resolvedUrl = interpolateSessionTemplates(input.url, input.sessionClaims);
  const resolvedHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers)) {
    resolvedHeaders[k] = interpolateSessionTemplates(v, input.sessionClaims);
  }

  const queryParams = new URLSearchParams();
  const bodyPayload: Record<string, unknown> = {};

  // 2. Resolve each parameter: session-mapped params ALWAYS come from verified JWT (immutable against LLM prompt injection!)
  for (const param of input.parameters) {
    let value: unknown;
    if (param.sessionClaim) {
      if (!input.sessionClaims) {
        throw new Error(`Parameter "${param.name}" requires verified session claim "${param.sessionClaim}"`);
      }
      value = getNestedClaim(input.sessionClaims, param.sessionClaim);
      if (value === undefined || value === null) {
        throw new Error(`Verified JWT is missing required claim "${param.sessionClaim}"`);
      }
    } else {
      value = input.llmArgs[param.name];
    }

    if (value === undefined || value === null) {
      if (param.required) {
        throw new Error(`Missing required parameter: ${param.name}`);
      }
      continue;
    }

    if (param.location === 'path') {
      resolvedUrl = resolvedUrl.replace(
        new RegExp(`\\{\\{${param.name}\\}\\}|:${param.name}\\b`, 'g'),
        encodeURIComponent(String(value))
      );
    } else if (param.location === 'query') {
      queryParams.set(param.name, String(value));
    } else if (param.location === 'header') {
      resolvedHeaders[param.name] = String(value);
    } else {
      bodyPayload[param.name] = value;
    }
  }

  const finalUrl = new URL(resolvedUrl);
  queryParams.forEach((v, k) => finalUrl.searchParams.set(k, v));

  const hasBody = input.method !== 'GET' && Object.keys(bodyPayload).length > 0;
  if (hasBody && !Object.keys(resolvedHeaders).some((k) => k.toLowerCase() === 'content-type')) {
    resolvedHeaders['Content-Type'] = 'application/json';
  }

  const res = await safeFetch(finalUrl.toString(), {
    method: input.method,
    headers: resolvedHeaders,
    body: hasBody ? JSON.stringify(bodyPayload) : undefined,
    timeoutMs: 10_000,
    maxBytes: 512 * 1024,
    allowLoopbackForTest: input.allowLoopbackForTest,
  });

  let parsedData: unknown = res.bodyText;
  try {
    parsedData = JSON.parse(res.bodyText);
  } catch {
    // Non-JSON response kept as text
  }

  return {
    status: res.status,
    ok: res.status >= 200 && res.status < 300,
    data: parsedData,
    rawBody: res.bodyText.slice(0, 4000),
    durationMs: Date.now() - start,
  };
}

// Remote MCP (Model Context Protocol) JSON-RPC over HTTP client (protected by anti-SSRF safeFetch)
export interface McpRemoteTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export async function listRemoteMcpTools(
  serverUrl: string,
  headers: Record<string, string>,
  allowLoopbackForTest = false
): Promise<McpRemoteTool[]> {
  const res = await safeFetch(serverUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    timeoutMs: 8_000,
    allowLoopbackForTest,
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`MCP server returned HTTP ${res.status}`);
  }
  const parsed = JSON.parse(res.bodyText) as { result?: { tools?: McpRemoteTool[] } };
  return parsed.result?.tools ?? [];
}

export async function callRemoteMcpTool(
  serverUrl: string,
  headers: Record<string, string>,
  toolName: string,
  args: Record<string, unknown>,
  allowLoopbackForTest = false
): Promise<unknown> {
  const res = await safeFetch(serverUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    }),
    timeoutMs: 12_000,
    allowLoopbackForTest,
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`MCP tool call failed with HTTP ${res.status}`);
  }
  const parsed = JSON.parse(res.bodyText) as { result?: unknown; error?: { message?: string } };
  if (parsed.error) {
    throw new Error(parsed.error.message || 'MCP tool call error');
  }
  return parsed.result;
}
