// Sending the print file after the order was placed.
//
// The shop deliberately lets people buy before their artwork exists — a phone
// order, a repeat job, a designer still finishing — and the confirmation email
// then asks them to reply with the file. A mailbox is not a queue: the file
// lands among everything else and somebody has to carry it to the job by hand.
//
// This is that same promise with a button behind it. It appears on the order
// page the customer lands on after paying, and again in "My orders", against
// exactly the lines that are still waiting.
//
// The bytes go straight from the browser to object storage — the server never
// sees them — and only the resulting download URL is posted to the order, which
// the server checks belongs to our own bucket before it writes it down.

import React, { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Upload } from 'lucide-react';
import { signInAnonymously } from 'firebase/auth';
import { auth } from '../firebase';
// Extension → the content type it is stored as, and the formats this box offers:
// one list, in uploadFile, which every upload in the shop now uses (code review WEB-04).
import { ARTWORK_CONTENT_TYPES as ACCEPTED, uploadFile } from '../lib/uploadFile';
import { useAuth } from '../App';
import { cn } from '../lib/utils';
import { formatSizeForShopper } from '../lib/printSize';

/** Matches storage.rules; there is no point letting the browser start a 60 MB upload that the bucket will refuse. */
const MAX_MB = 50;

const extensionOf = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '');

export interface ArtworkUploadBoxProps {
  orderId: string;
  /** The token from the order link. A guest has only this; a signed-in customer sends both. */
  token?: string;
  itemIndex: number;
  productName?: string;
  /**
   * The size this line is printed at — 15.6.4.
   *
   * The box had no idea. Its whole job is "send us the file for this job" and
   * it could not say how big the file has to be, on the one screen the customer
   * opens days later when his designer is finally done. It is also what the
   * server records against the file: without it every after-payment upload was
   * stored as 0 × 0.
   */
  widthCm?: number;
  heightCm?: number;
  /** Called with the stored file name once the order has actually been updated. */
  onUploaded?: (fileName: string) => void;
  className?: string;
}

type Phase = { kind: 'idle' } | { kind: 'uploading'; percent: number } | { kind: 'attaching' } | { kind: 'done'; fileName: string };

export default function ArtworkUploadBox({
  orderId,
  token,
  itemIndex,
  productName,
  widthCm,
  heightCm,
  onUploaded,
  className,
}: ArtworkUploadBoxProps) {
  const { t } = useAuth();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);

  const busy = phase.kind === 'uploading' || phase.kind === 'attaching';

  const handle = async (file: File) => {
    setError(null);

    const ext = extensionOf(file.name);
    const contentType = ACCEPTED[ext];
    if (!contentType) {
      setError(t('auBadType'));
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(t('auTooLarge').replace('{0}', (file.size / 1024 / 1024).toFixed(1)).replace('{1}', String(MAX_MB)));
      return;
    }

    try {
      setPhase({ kind: 'uploading', percent: 0 });

      // The bucket keys on the uploader's own uid, and most people reading a
      // confirmation email are not signed in. An anonymous identity is enough
      // to own a folder — and it is only taken when there is no session to
      // preserve, because signing in anonymously over a real account would
      // throw that account out of the tab.
      let uid = auth.currentUser?.uid;
      if (!uid) uid = (await signInAnonymously(auth)).user.uid;

      const up = await uploadFile(file, {
        userId: uid,
        folder: 'artwork',
        contentType,
        onProgress: (percent) => setPhase({ kind: 'uploading', percent }),
      });

      setPhase({ kind: 'attaching' });

      // Both proofs, whichever the order recognises: a signed-in customer may
      // own it through their account, a guest only through the link token.
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const idToken = await auth.currentUser?.getIdToken().catch(() => null);
      if (idToken) headers.Authorization = `Bearer ${idToken}`;

      const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/artwork`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          t: token ?? '',
          itemIndex,
          fileUrl: up.url,
          fileName: file.name,
          fileType: ext.toUpperCase(),
          // Clamped on the server before it is stored; sent so a line that was
          // never priced by area still records the size the customer was shown.
          ...(Number(widthCm) > 0 && Number(heightCm) > 0 ? { widthCm, heightCm } : {}),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || t('auFailed'));

      setPhase({ kind: 'done', fileName: file.name });
      onUploaded?.(file.name);
    } catch (err: any) {
      console.error('Attaching the print file failed:', err);
      setPhase({ kind: 'idle' });
      setError(err?.message || t('auFailed'));
    }
  };

  if (phase.kind === 'done') {
    return (
      <div className={cn('flex items-center gap-2 text-xs font-bold text-green-700 bg-green-50 border border-green-200 rounded-xl px-3 py-2.5', className)}>
        <CheckCircle2 className="w-4 h-4 shrink-0" />
        <span className="truncate">{t('auDone').replace('{0}', phase.fileName)}</span>
      </div>
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={Object.keys(ACCEPTED).map((e) => `.${e}`).join(',')}
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Cleared so choosing the same file again after an error still fires.
          e.target.value = '';
          if (file) void handle(file);
        }}
      />

      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="w-full px-4 py-2.5 rounded-xl bg-[#bb965b] hover:bg-[#a8854f] disabled:opacity-60 disabled:cursor-not-allowed text-white text-xs font-black shadow-md transition-colors flex items-center justify-center gap-2"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
        <span>
          {phase.kind === 'uploading'
            ? t('auUploading').replace('{0}', String(phase.percent))
            : phase.kind === 'attaching'
              ? t('auAttaching')
              : t('auChoose')}
        </span>
      </button>

      {/* THE SIZE HIS FILE HAS TO BE — 15.6.4. He is opening this days after the
          order, on a link in an email, with a designer asking him how big to
          make it. The answer was nowhere on this screen. */}
      {Number(widthCm) > 0 && Number(heightCm) > 0 && phase.kind === 'idle' && !error && (
        <p className="text-[0.6875rem] font-black text-orange-600">
          {/* Both sizes the shop accepts (src/lib/artworkFit.ts), as the product page says. */}
          {t('ppArtworkSizeHint').replace(
            '{0}',
            formatSizeForShopper(Number(widthCm) * 10, Number(heightCm) * 10) +
              t('cfgOrWithBleed').replace('{0}', formatSizeForShopper(Number(widthCm) * 10 + 6, Number(heightCm) * 10 + 6)),
          )}
        </p>
      )}
      {productName && phase.kind === 'idle' && !error && (
        <p className="text-[0.6875rem] font-semibold text-gray-500 truncate">{t('auForLine').replace('{0}', productName)}</p>
      )}

      {error && (
        <p className="flex items-start gap-1.5 text-[0.6875rem] font-bold text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
