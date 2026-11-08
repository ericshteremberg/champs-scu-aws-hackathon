import DOMPurify from 'dompurify';
import html2canvas from 'html2canvas';
import { z } from 'zod';
import type { Evidence } from '../domain.ts';

const snapshotSchema = z.object({ schemaVersion: z.literal(1), provider: z.literal('resend'), caseId: z.string(), emailId: z.string(), capturedAt: z.string().datetime(), message: z.object({ id: z.string(), from: z.string().max(500), to: z.array(z.string()).max(50), subject: z.string().max(2000), created_at: z.string(), html: z.string().max(524288).nullable().optional(), text: z.string().max(524288).nullable().optional() }) });

/** Renders preserved provider content, never AI prose or a fabricated provider dashboard. */
export async function renderOriginalEmail(bytes: Uint8Array, record: Evidence): Promise<Uint8Array> {
  const snapshot = snapshotSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  if (snapshot.caseId !== record.caseId || snapshot.emailId !== record.originalEmail?.emailId || snapshot.message.id !== snapshot.emailId) throw new Error('The original email does not belong to this case record.');
  const message = snapshot.message;
  if (!message.html?.trim() && !message.text?.trim()) throw new Error('This provider snapshot has no original email body.');
  const container = document.createElement('div');
  if (message.html?.trim()) {
    container.innerHTML = DOMPurify.sanitize(message.html, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['style','script','iframe','object','embed','link','meta','base','form','input','button','select','textarea','video','audio','source'],
      FORBID_ATTR: ['src','href','srcset','action','formaction','background','ping','id','name','class'],
    });
    for (const node of container.querySelectorAll<HTMLElement>('*')) {
      // No provider-controlled CSS URLs, positioning over our metadata, or external resources.
      if (/url\s*\(|@import|expression\s*\(/i.test(node.getAttribute('style') || '')) node.removeAttribute('style');
      node.style.position = 'static'; node.style.float = 'none'; node.style.maxWidth = '100%';
      node.removeAttribute('src');
      if (node.tagName === 'IMG') node.replaceWith(document.createTextNode(`[Image omitted${node.getAttribute('alt') ? `: ${node.getAttribute('alt')}` : ''}]`));
    }
  } else { const pre = document.createElement('pre'); pre.textContent = message.text!; pre.style.whiteSpace = 'pre-wrap'; container.appendChild(pre); }
  if (container.querySelectorAll('*').length > 6000) throw new Error('This original email is too complex to render safely. Inspect the retained source file.');
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-same-origin'); frame.setAttribute('aria-hidden', 'true'); frame.setAttribute('title', 'Isolated original email renderer');
  Object.assign(frame.style, { position: 'fixed', left: '-10000px', top: '0', width: '900px', height: '1000px', border: '0', pointerEvents: 'none' });
  const loaded = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Original email rendering timed out.')), 10000);
    frame.onload = () => { clearTimeout(timeout); resolve(); };
  });
  frame.srcdoc = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-src 'self' about:; base-uri 'none'; form-action 'none'"><style>body{margin:0;padding:24px;background:white;color:#172333;font:16px Arial,sans-serif;overflow-wrap:anywhere}*{box-sizing:border-box}pre{white-space:pre-wrap}table{max-width:100%}</style></head><body></body></html>`;
  document.body.appendChild(frame);
  try {
    await loaded;
    const target = frame.contentDocument!.body;
    const header = frame.contentDocument!.createElement('div');
    header.style.cssText = 'font:14px Arial,sans-serif;white-space:pre-wrap;border-bottom:1px solid #ccd2da;padding:0 0 20px;margin:0 0 24px;color:#172333';
    header.textContent = `ORIGINAL EMAIL CONTENT | RESEND\nFrom: ${message.from}\nTo: ${message.to.join(', ')}\nSubject: ${message.subject}\nMessage date: ${message.created_at}\nProvider ID: ${snapshot.emailId}\nCollected: ${snapshot.capturedAt}\nRendered from retained provider content. Remote images, stylesheets and active content omitted.`;
    target.appendChild(header); target.appendChild(frame.contentDocument!.importNode(container, true));
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const height = Math.max(target.scrollHeight, 200);
    if (height > 12000 || target.scrollWidth > 950) throw new Error('This email exceeds the visual capture size. The original file remains available.');
    frame.style.height = `${height}px`;
    const canvas = await html2canvas(target, { width: 900, height, windowWidth: 900, windowHeight: height, scale: 1, backgroundColor: '#ffffff', logging: false, allowTaint: false, useCORS: false, imageTimeout: 1000 });
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('The original email could not be rendered.')), 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  } finally { frame.remove(); }
}
