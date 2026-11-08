"use client";

import { useState } from 'react';
import { Link2, LoaderCircle, ShieldCheck, Unplug } from 'lucide-react';
import type { ProviderStatus, StripeProviderConnection } from '../../lib/providers/types';

export function StripeAccountConnector({ status, onChange }: { status: ProviderStatus['stripe'] | undefined; onChange: (connection: StripeProviderConnection | null) => void }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const connection = status?.connection;
  const active = connection?.status === 'authorized';
  const call = async (action: 'connect' | 'verify' | 'disconnect') => {
    setBusy(action); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/providers/stripe${action === 'connect' ? '/start' : ''}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action === 'connect' ? {} : { action }), cache: 'no-store' });
      const result = await response.json() as { error?: string; authorizationUrl?: string; connection?: StripeProviderConnection | null; chargeReadVerified?: boolean };
      if (!response.ok) throw new Error(result.error || 'Stripe could not complete the request.');
      if (action === 'connect') {
        const url = new URL(result.authorizationUrl || '');
        if (url.origin !== 'https://marketplace.stripe.com' || !/^\/oauth\/v2\/(?:[A-Za-z0-9_-]+\/)?authorize$/.test(url.pathname)) throw new Error('The Stripe authorization address is invalid.');
        window.location.assign(url.toString()); return;
      }
      onChange(result.connection || null);
      setConfirmDisconnect(false);
      setNotice(action === 'disconnect' ? 'Stripe access stopped in Causality. Uninstall Causality in Stripe Installed Apps to revoke its authorization there.' : result.chargeReadVerified ? 'Dispute and linked payment read access verified. No customer record contents were saved.' : 'Dispute read access verified. There was no linked charge available to test payment access.');
    } catch (e) { setError(e instanceof Error ? e.message : 'The Stripe request failed.'); }
    finally { setBusy(''); }
  };
  return <article className="cw-provider-card" aria-label="Stripe account authorization">
    <h3>Stripe <span className={`cw-pill${active ? ' green' : ''}`}>{active ? 'Authorized' : connection?.status === 'reconnect_required' ? 'Reconnect required' : 'Not connected'}</span></h3>
    <p>Read disputes, payments and refunds. This connection cannot refund or submit evidence.</p>
    <p className="cw-provider-note">External test app · Not reviewed by Stripe. Install only if you trust the developer.</p>
    {error && <p className="cw-banner error" role="alert">{error}</p>}
    {notice && <p className="cw-banner neutral" role="status">{notice}</p>}
    {connection?.accountId && <p>Account: <strong>{connection.accountId}</strong><br />Environment: {connection.mode === 'live' ? 'Live' : 'Test'}</p>}
    {connection?.lastVerifiedAt && <p className="cw-provider-note">Last verified: {new Date(connection.lastVerifiedAt).toLocaleString()}{!connection.chargeReadVerified && '. Payment read access still needs a linked charge.'}</p>}
    {active && <><p className="cw-provider-note">Checks one dispute and its payment; does not import or save records.</p><button className="cw-button primary" disabled={!!busy} onClick={() => void call('verify')}>{busy === 'verify' ? <LoaderCircle size={16} /> : <ShieldCheck size={16} />}Verify read access</button></>}
    {!connection || connection.status === 'disconnected' ? <>
      {connection?.uninstallRequired && <p className="cw-provider-note">Uninstall Causality in Stripe before reconnecting if Stripe reports that the app is already installed.</p>}
      <button className="cw-button primary" disabled={!!busy || !status?.configured} onClick={() => void call('connect')}>{busy === 'connect' ? <LoaderCircle size={16} /> : <Link2 size={16} />}{status?.configured ? 'Connect Stripe' : 'Stripe setup unavailable'}</button>
    </> : confirmDisconnect ? <div className="cw-provider-disconnect"><p>Stop Causality access and delete its saved Stripe tokens? To revoke the app grant, also uninstall Causality in Stripe.</p><div className="cw-actions"><button className="cw-button" disabled={!!busy} onClick={() => setConfirmDisconnect(false)}>Keep Stripe connection</button><button className="cw-button danger" disabled={!!busy} onClick={() => void call('disconnect')}>Confirm disconnect Stripe</button></div></div> : <button className="cw-button" disabled={!!busy} onClick={() => setConfirmDisconnect(true)}><Unplug size={16} />Disconnect Stripe</button>}
    <p className="cw-provider-note"><a href="https://dashboard.stripe.com/settings/apps" target="_blank" rel="noopener noreferrer">Manage installed apps in Stripe</a></p>
  </article>;
}
