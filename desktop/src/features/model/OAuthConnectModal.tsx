import type { Component } from 'solid-js';
import { createSignal, Show, Switch, Match } from 'solid-js';
import { openUrl } from '@tauri-apps/plugin-opener';
import type {
  OAuthProvider,
  OAuthStartResponse,
  OAuthPollResponse,
} from '@/services/api/types';
import { api } from '@/services/api/router';
import { Modal } from '@/ui/molecules/Modal';
import { Button } from '@/ui/atoms/Button';
import { Input } from '@/ui/atoms/Input';
import { Icon } from '@/ui/atoms/Icon';
import styles from './OAuthConnectModal.module.css';

export interface OAuthConnectModalProps {
  open: boolean;
  provider: OAuthProvider | null;
  onClose: () => void;
  onConnected: () => void; // refresh provider list after successful auth
}

type PkceStep = 'idle' | 'connecting' | 'awaiting_code' | 'submitting' | 'done' | 'error';
type DeviceStep = 'idle' | 'connecting' | 'awaiting_code' | 'polling' | 'done' | 'error';

function maskToken(token: string | undefined | null): string {
  if (!token) return '';
  if (token.length <= 8) return token;
  return token.slice(0, 4) + '••••' + token.slice(-4);
}

export const OAuthConnectModal: Component<OAuthConnectModalProps> = (props) => {
  // PKCE state
  const [pkceStep, setPkceStep] = createSignal<PkceStep>('idle');
  const [pkceAuthUrl, setPkceAuthUrl] = createSignal('');
  const [pkceSessionId, setPkceSessionId] = createSignal('');
  const [pkceCode, setPkceCode] = createSignal('');
  const [pkceError, setPkceError] = createSignal('');

  // Device-code state
  const [deviceStep, setDeviceStep] = createSignal<DeviceStep>('idle');
  const [deviceSessionId, setDeviceSessionId] = createSignal('');
  const [userCode, setUserCode] = createSignal('');
  const [verificationUrl, setVerificationUrl] = createSignal('');
  const [pollInterval, setPollInterval] = createSignal(2);
  const [deviceError, setDeviceError] = createSignal('');
  let deviceTimer: ReturnType<typeof setInterval> | null = null;

  // Loopback state (auto-callback via local HTTP listener — no code to paste)
  const [loopbackAuthUrl, setLoopbackAuthUrl] = createSignal('');

  const providerName = () => props.provider?.name ?? '';
  const flow = () => props.provider?.flow;

  // ── Reset on open ──
  const reset = () => {
    setPkceStep('idle');
    setPkceAuthUrl('');
    setPkceSessionId('');
    setPkceCode('');
    setPkceError('');
    setDeviceStep('idle');
    setDeviceSessionId('');
    setUserCode('');
    setVerificationUrl('');
    setPollInterval(2);
    setDeviceError('');
    setLoopbackAuthUrl('');
    if (deviceTimer) { clearInterval(deviceTimer); deviceTimer = null; }
  };

  const handleClose = () => {
    // Cancel pending session if user closes modal mid-flow
    const sid = deviceSessionId() || pkceSessionId();
    if (sid) {
      try { void api.oauth().cancelSession(sid); } catch { void 0; }
    }
    reset();
    props.onClose();
  };

  // ── Open browser (3-tier: Tauri command → plugin → fallback) ──
  // Mirrors the Electron app's openSignInUrl() pattern:
  //   window.hermesDesktop.openExternal(url) → window.open(url)
  const openBrowser = async (url: string) => {
    // Tier 1: Tauri open_external command (Rust `open` crate — most reliable)
    try {
      const tauri = (window as unknown as { __TAURI__?: { core?: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } } }).__TAURI__;
      if (tauri?.core?.invoke) {
        await tauri.core.invoke('open_external', { url });
        return;
      }
    } catch (e) {
      console.warn('[OAuth] open_external failed, trying plugin-opener:', e);
    }
    // Tier 2: @tauri-apps/plugin-opener
    try {
      await openUrl(url);
      return;
    } catch (e) {
      console.warn('[OAuth] plugin-opener failed, falling back to window.open:', e);
    }
    // Tier 3: Last resort for non-Tauri environments (dev browser)
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  // ── PKCE flow ──
  const startPkce = async () => {
    if (!props.provider) return;
    setPkceStep('connecting');
    setPkceError('');
    try {
      const resp: OAuthStartResponse = await api.oauth().start(props.provider.id);
      setPkceSessionId(resp.session_id);
      if (resp.auth_url) {
        setPkceAuthUrl(resp.auth_url);
        openBrowser(resp.auth_url);
        setPkceStep('awaiting_code');
      } else {
        setPkceError('No auth URL returned');
        setPkceStep('error');
      }
    } catch (e: unknown) {
      setPkceError(e instanceof Error ? e.message : 'Failed to start authorization');
      setPkceStep('error');
    }
  };

  const submitPkceCode = async () => {
    const code = pkceCode().trim();
    if (!code || !props.provider) return;
    setPkceStep('submitting');
    setPkceError('');
    try {
      await api.oauth().submit(props.provider.id, pkceSessionId(), code);
      setPkceStep('done');
      props.onConnected();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Code submission failed';
      // Check if it's an invalid code vs network error
      if (msg.includes('Unknown or expired') || msg.includes('404')) {
        setPkceError('Session expired. Please try again.');
        setPkceStep('error');
      } else {
        setPkceError(msg);
        setPkceStep('error');
      }
    }
  };

  // ── Device-code flow ──
  const startDeviceCode = async () => {
    if (!props.provider) return;
    setDeviceStep('connecting');
    setDeviceError('');
    try {
      const resp: OAuthStartResponse = await api.oauth().start(props.provider.id);
      setDeviceSessionId(resp.session_id);
      if (resp.user_code && resp.verification_url) {
        setUserCode(resp.user_code);
        setVerificationUrl(resp.verification_url);
        setPollInterval(resp.poll_interval ?? 3);
        openBrowser(resp.verification_url);
        setDeviceStep('awaiting_code');
        // Wait a beat before starting to poll
        setTimeout(() => {
          setDeviceStep('polling');
          startPolling(resp.session_id);
        }, 2000);
      } else {
        setDeviceError('Could not retrieve device code');
        setDeviceStep('error');
      }
    } catch (e: unknown) {
      setDeviceError(e instanceof Error ? e.message : 'Failed to start device auth');
      setDeviceStep('error');
    }
  };

  // ── Loopback flow (auto-callback) ──
  // Opens browser; backend's local HTTP listener catches the redirect and
  // completes the token exchange automatically. Just poll until approved.
  const startLoopback = async () => {
    if (!props.provider) return;
    setDeviceStep('connecting');
    setDeviceError('');
    try {
      const resp: OAuthStartResponse = await api.oauth().start(props.provider.id);
      setDeviceSessionId(resp.session_id);
      if (resp.auth_url) {
        setLoopbackAuthUrl(resp.auth_url);
        openBrowser(resp.auth_url);
        setDeviceStep('awaiting_code');
        // Wait a beat before starting to poll
        setTimeout(() => {
          startPolling(resp.session_id);
        }, 3000);
      } else {
        setDeviceError('No authorization URL returned');
        setDeviceStep('error');
      }
    } catch (e: unknown) {
      setDeviceError(e instanceof Error ? e.message : 'Failed to start authorization');
      setDeviceStep('error');
    }
  };

  const startPolling = (sessionId: string) => {
    if (deviceTimer) clearInterval(deviceTimer);
    deviceTimer = setInterval(async () => {
      if (!props.provider) return;
      try {
        const resp: OAuthPollResponse = await api.oauth().poll(
          props.provider.id, sessionId,
        );
        if (resp.status === 'approved') {
          if (deviceTimer) clearInterval(deviceTimer);
          setDeviceStep('done');
          props.onConnected();
        } else if (resp.status === 'error' || resp.status === 'denied' || resp.status === 'expired') {
          if (deviceTimer) clearInterval(deviceTimer);
          setDeviceError(resp.error_message ?? `Authorization ${resp.status}`);
          setDeviceStep('error');
        }
        // 'pending' — keep polling
      } catch (e: unknown) {
        if (deviceTimer) clearInterval(deviceTimer);
        setDeviceError(e instanceof Error ? e.message : 'Polling failed');
        setDeviceStep('error');
      }
    }, pollInterval() * 1000);
  };

  const copyUserCode = () => {
    void navigator.clipboard.writeText(userCode());
  };

  // ── Disconnect ──
  const disconnect = async () => {
    if (!props.provider) return;
    try {
      await api.oauth().disconnect(props.provider.id);
      props.onConnected();
    } catch (e: unknown) {
      console.error('Failed to disconnect:', e);
    }
  };

  // ── Render ──
  const renderContent = () => {
    if (!props.provider) return null;

    // Already connected
    if (props.provider.logged_in) {
      return (
        <div class={styles.statusSection}>
          <div class={styles.statusRow}>
            <span class={styles.connectedLabel}>Connected</span>
            <span class={styles.sourceLabel}>
              {props.provider.source_label ?? props.provider.source ?? ''}
            </span>
          </div>
          <Show when={props.provider.token_preview}>
            <div class={styles.tokenInfo}>
              <span class={styles.tokenLabel}>Token:</span>
              <code class={styles.tokenValue}>{maskToken(props.provider.token_preview)}</code>
            </div>
          </Show>
          <div class={styles.disconnectRow}>
            <Button variant="secondary" size="sm" onClick={disconnect}>
              <Icon name="trash-2" size={14} />
              Disconnect
            </Button>
          </div>
        </div>
      );
    }

    // PKCE flow
    if (flow() === 'pkce') {
      return (
        <Switch>
          <Match when={pkceStep() === 'idle' || pkceStep() === 'connecting'}>
            <div class={styles.startSection}>
              <p class={styles.instruction}>
                Connect your Anthropic account to use Claude models via OAuth.
                You'll be redirected to authorize Hermes.
              </p>
              <Button variant="primary" size="md" onClick={startPkce} disabled={pkceStep() === 'connecting'}>
                {pkceStep() === 'connecting' ? (
                  <>
                    <Icon name="loader" size={14} />
                    Connecting...
                  </>
                ) : (
                  <>
                    <Icon name="external-link" size={14} />
                    Connect with Anthropic
                  </>
                )}
              </Button>
            </div>
          </Match>
          <Match when={pkceStep() === 'awaiting_code'}>
            <div class={styles.codeSection}>
              <p class={styles.instruction}>
                A browser window opened with the Anthropic authorization page.
                After approving, copy the authorization code and paste it below.
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => openBrowser(pkceAuthUrl())}
              >
                <Icon name="external-link" size={14} />
                Reopen Browser
              </Button>
              <div class={styles.codeInput}>
                <Input
                  label="Authorization Code"
                  placeholder="Paste the code from the browser..."
                  value={pkceCode()}
                  onInput={(e) => setPkceCode((e.target as HTMLInputElement).value)}
                />
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={submitPkceCode}
                disabled={!pkceCode().trim() || pkceStep() === 'submitting'}
              >
                {pkceStep() === 'submitting' ? 'Verifying...' : 'Submit'}
              </Button>
            </div>
          </Match>
          <Match when={pkceStep() === 'error'}>
            <div class={styles.errorSection}>
              <p class={styles.errorText}>{pkceError()}</p>
              <div class={styles.errorActions}>
                <Button variant="primary" size="sm" onClick={startPkce}>
                  Try Again
                </Button>
                <Button variant="secondary" size="sm" onClick={handleClose}>
                  Cancel
                </Button>
              </div>
            </div>
          </Match>
          <Match when={pkceStep() === 'done'}>
            <div class={styles.doneSection}>
              <span class={styles.connectedLabel}>Connected</span>
              <p class={styles.doneText}>Successfully connected to Anthropic!</p>
            </div>
          </Match>
        </Switch>
      );
    }

    // Device-code flow
    if (flow() === 'device_code') {
      return (
        <Switch>
          <Match when={deviceStep() === 'idle' || deviceStep() === 'connecting'}>
            <div class={styles.startSection}>
              <p class={styles.instruction}>
                Connect to {providerName()} using device authorization.
                You'll be shown a one-time code to enter on their site.
              </p>
              <Button variant="primary" size="md" onClick={startDeviceCode} disabled={deviceStep() === 'connecting'}>
                {deviceStep() === 'connecting' ? (
                  <>
                    <Icon name="loader" size={14} />
                    Connecting...
                  </>
                ) : (
                  <>
                    <Icon name="external-link" size={14} />
                    Connect with {providerName()}
                  </>
                )}
              </Button>
            </div>
          </Match>
          <Match when={deviceStep() === 'awaiting_code' || deviceStep() === 'polling'}>
            <div class={styles.deviceSection}>
              <p class={styles.instruction}>
                A browser window opened at the {providerName()} authorization page.
                Enter the code below:
              </p>
              <div class={styles.userCodeBox}>
                <code class={styles.userCode}>{userCode()}</code>
                <button type="button" class={styles.copyBtn} onClick={copyUserCode} title="Copy code">
                  <Icon name="copy" size={16} />
                </button>
              </div>
              <div class={styles.pollingStatus}>
                <Icon name="loader" size={16} />
                <span>Waiting for authorization{deviceStep() === 'polling' ? '...' : ''}</span>
              </div>
              <Show when={verificationUrl()}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => openBrowser(verificationUrl())}
                >
                  <Icon name="external-link" size={14} />
                  Reopen Page
                </Button>
              </Show>
            </div>
          </Match>
          <Match when={deviceStep() === 'error'}>
            <div class={styles.errorSection}>
              <p class={styles.errorText}>{deviceError()}</p>
              <div class={styles.errorActions}>
                <Button variant="primary" size="sm" onClick={startDeviceCode}>
                  Try Again
                </Button>
                <Button variant="secondary" size="sm" onClick={handleClose}>
                  Cancel
                </Button>
              </div>
            </div>
          </Match>
          <Match when={deviceStep() === 'done'}>
            <div class={styles.doneSection}>
              <span class={styles.connectedLabel}>Connected</span>
              <p class={styles.doneText}>Successfully connected to {providerName()}!</p>
            </div>
          </Match>
        </Switch>
      );
    }

    // Loopback flow — browser opens, backend catches redirect via local HTTP
    // listener. No code to paste, no user_code to show — fully automatic.
    if (flow() === 'loopback') {
      return (
        <Switch>
          <Match when={deviceStep() === 'idle' || deviceStep() === 'connecting'}>
            <div class={styles.startSection}>
              <p class={styles.instruction}>
                Connect your {providerName()} account. A browser will open for
                authorization — you'll be connected automatically.
              </p>
              <Button variant="primary" size="md" onClick={startLoopback} disabled={deviceStep() === 'connecting'}>
                {deviceStep() === 'connecting' ? (
                  <>
                    <Icon name="loader" size={14} />
                    Connecting...
                  </>
                ) : (
                  <>
                    <Icon name="external-link" size={14} />
                    Connect with {providerName()}
                  </>
                )}
              </Button>
            </div>
          </Match>
          <Match when={deviceStep() === 'awaiting_code'}>
            <div class={styles.deviceSection}>
              <p class={styles.instruction}>
                A browser window opened at the {providerName()} authorization page.
                Authorize Hermes there and you'll be connected automatically.
              </p>
              <div class={styles.pollingStatus}>
                <Icon name="loader" size={16} />
                <span>Waiting for authorization...</span>
              </div>
              <Show when={loopbackAuthUrl()}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => openBrowser(loopbackAuthUrl())}
                >
                  <Icon name="external-link" size={14} />
                  Reopen Page
                </Button>
              </Show>
            </div>
          </Match>
          <Match when={deviceStep() === 'error'}>
            <div class={styles.errorSection}>
              <p class={styles.errorText}>{deviceError()}</p>
              <div class={styles.errorActions}>
                <Button variant="primary" size="sm" onClick={startLoopback}>
                  Try Again
                </Button>
                <Button variant="secondary" size="sm" onClick={handleClose}>
                  Cancel
                </Button>
              </div>
            </div>
          </Match>
          <Match when={deviceStep() === 'done'}>
            <div class={styles.doneSection}>
              <span class={styles.connectedLabel}>Connected</span>
              <p class={styles.doneText}>Successfully connected to {providerName()}!</p>
            </div>
          </Match>
        </Switch>
      );
    }

    // External flow — show CLI command
    if (flow() === 'external') {
      return (
        <div class={styles.externalSection}>
          <p class={styles.instruction}>
            {providerName()} requires a CLI-based setup. Run this command in your terminal:
          </p>
          <div class={styles.cliBox}>
            <code class={styles.cliCommand}>{props.provider.cli_command ?? `hermes auth add ${props.provider.id}`}</code>
            <button
              type="button"
              class={styles.copyBtn}
              onClick={() => void navigator.clipboard.writeText(props.provider?.cli_command ?? '')}
              title="Copy command"
            >
              <Icon name="copy" size={16} />
            </button>
          </div>
          <Show when={props.provider.docs_url}>
            <a
              href={props.provider.docs_url!}
              target="_blank"
              rel="noopener noreferrer"
              class={styles.docsLink}
            >
              <Icon name="external-link" size={14} />
              View documentation
            </a>
          </Show>
        </div>
      );
    }

    return null;
  };

  return (
    <Modal
      open={props.open && props.provider !== null}
      title={`${providerName()} — OAuth Setup`}
      onClose={handleClose}
    >
      {renderContent()}
    </Modal>
  );
};
