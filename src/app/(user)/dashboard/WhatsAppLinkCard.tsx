'use client';

import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

/** The account's WhatsApp number as a click-to-chat link (wa.me) and a QR code to scan: copy the link, download the QR. */
export function WhatsAppLinkCard({ number }: { number: string }) {
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);
  const link = `https://wa.me/${number}`;

  useEffect(() => {
    let live = true;
    QRCode.toDataURL(link, { width: 480, margin: 1, errorCorrectionLevel: 'M' })
      .then((url) => { if (live) setQr(url); })
      .catch(() => { if (live) setQr(''); });
    return () => { live = false; };
  }, [link]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const t = document.createElement('textarea');
      t.value = link;
      document.body.appendChild(t);
      t.select();
      document.execCommand('copy');
      t.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="card card-animate card-height-100">
      <div className="card-body">
        <p className="text-uppercase fw-medium text-muted mb-2" title="Customers scan the QR code or open the link to chat with your WhatsApp number">
          Chat on WhatsApp <i className="ri-information-line" />
        </p>
        <div className="d-flex gap-2 align-items-center">
          {qr
            ? <img src={qr} alt={`QR code to chat on WhatsApp with +${number}`} width={88} height={88} className="border rounded flex-shrink-0" />
            : <div className="border rounded flex-shrink-0 placeholder-glow" style={{ width: 88, height: 88 }}><span className="placeholder w-100 h-100" /></div>}
          <div className="flex-grow-1" style={{ minWidth: 0 }}>
            <a href={link} target="_blank" rel="noreferrer" className="d-block small fw-medium text-truncate mb-2" title={`Open ${link}`}>
              wa.me/{number}
            </a>
            <div className="d-flex flex-wrap gap-1">
              <button type="button" className="btn btn-soft-primary btn-sm" onClick={copy} title="Copy the link">
                <i className={copied ? 'ri-check-line' : 'ri-file-copy-line'} /> {copied ? 'Copied' : 'Copy'}
              </button>
              {qr && (
                <a href={qr} download={`whatsapp-${number}.png`} className="btn btn-soft-secondary btn-sm" title="Download the QR code" aria-label="Download the QR code">
                  <i className="ri-download-2-line" />
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
