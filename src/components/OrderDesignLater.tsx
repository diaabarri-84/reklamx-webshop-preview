// A paid line that is still waiting for the design the customer chose to make online
// (designer v2, design later) — on his order page and in "My orders".
//
// "Create your design" opens the same gallery and studio the product page has, at
// the line's own size, cut and pages; the finished design goes to the order through
// the endpoint a file sent later uses. A customer whose designer made the file
// elsewhere after all can still send that instead.

import React, { useState } from 'react';
import { useAuth } from '../App';
import ArtworkUploadBox from './ArtworkUploadBox';
import DesignLater, { sendDesignToOrder } from './product/designer/DesignLater';
import type { DesignLaterMarker } from '../lib/designLater';

export default function OrderDesignLater({
  orderId,
  token,
  itemIndex,
  productId,
  productName,
  showName,
  marker,
  widthCm,
  heightCm,
  onDone,
}: {
  orderId: string;
  /** The token from the order link. A guest has only this; a signed-in customer sends both. */
  token?: string;
  itemIndex: number;
  productId: string;
  productName: string;
  /** Name the line (when the order has more than one waiting). */
  showName?: boolean;
  marker: DesignLaterMarker;
  widthCm?: number;
  heightCm?: number;
  /** Once the order has its design (with its first page's picture) or the file sent instead. */
  onDone?: (preview?: string) => void;
}) {
  const { t } = useAuth();
  const [withFile, setWithFile] = useState(false);
  // Which way it arrived: the other way then goes (the order takes only one).
  const [done, setDone] = useState<'design' | 'file' | null>(null);
  return (
    <div className="space-y-2" data-rx-order-design-later={itemIndex}>
      {showName && productName && (
        <p className="text-[0.6875rem] font-semibold text-gray-500 truncate">{t('auForLine').replace('{0}', productName)}</p>
      )}
      {done !== 'file' && (
        <DesignLater
          marker={marker}
          productId={productId}
          productName={productName}
          saveKey={`order:${orderId}:${itemIndex}`}
          onDesigned={async (design) => {
            const sent = await sendDesignToOrder({ orderId, token, itemIndex, design, widthCm, heightCm, t });
            setDone('design');
            // "Already there": an earlier try arrived — its picture is the order's, not this one.
            onDone?.(sent === 'sent' ? design.previews[0]?.url : undefined);
            // …and the box says so, instead of "Your design is saved." for one that was not.
            return sent === 'already' ? ('already' as const) : undefined;
          }}
        />
      )}
      {done !== 'design' &&
        (withFile ? (
          <ArtworkUploadBox
            orderId={orderId}
            token={token}
            itemIndex={itemIndex}
            widthCm={widthCm}
            heightCm={heightCm}
            onUploaded={() => {
              setDone('file');
              onDone?.();
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setWithFile(true)}
            className="text-[0.6875rem] font-bold text-gray-500 underline underline-offset-2 hover:text-gray-800"
            data-rx-order-design-later-file
          >
            {t('stDlOrFile')}
          </button>
        ))}
    </div>
  );
}
