import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle, FileText, Package, Printer, X, ZoomIn } from 'lucide-react';
import { Order } from '../types';
import { isDisplayableImage } from '../lib/utils';
import { previewOf } from '../lib/designFileSpecs';
import { formatDate, formatDateTime, formatDispatchWeekday } from '../lib/dateFormat';
import Barcode from './Barcode';
import SafeImage from './SafeImage';
import DesignAttachmentModal from './DesignAttachmentModal';
import { printSizeOf } from '../lib/printSize';
import { deliveryAddressOf } from '../lib/deliveryAddress';
import { LinePictureView, pictureOf, useProductImages } from './LinePicture';

/** The packer's picture per item: very big for one, smaller as they add up (one A4 page). */
function slipPictureSize(lines: number): number {
  if (lines <= 1) return 200;
  if (lines <= 3) return 110;
  if (lines <= 8) return 72;
  return 48;
}

/**
 * THE PACKING SLIP — the sheet that travels with the box.
 *
 * The owner sent his supplier's own slip (HelloPrint order 6060403-9633154) and
 * asked for the same document out of this shop: "ملف تاني يكون PDF فيه طلبات
 * العميل بالكامل، اختار ملف إيه ومقاسه إيه وكل شيء اللي عمله العميل". So this is
 * that slip, in our numbers: the barcode, where the box is going, who is
 * carrying it, and — line by line — every single choice the customer made,
 * including the file they uploaded and the size it prints at.
 *
 * WHY IT IS NOT THE JOB SHEET
 * The job sheet is a workshop document: pre-press notes, bleed, machine
 * settings, the whole technical page. This is the opposite — one page, no
 * jargon, no prices, readable by whoever is taping the box shut and by the
 * customer who opens it. Both exist because they are read by different people at
 * different moments, and a document that tries to be both gets read by neither.
 *
 * NO PRICES, deliberately. A packing slip goes in the box; the invoice goes to
 * the person who pays, and they are not always the same person.
 *
 * It prints through window.print() like the shop's other three documents, and
 * the `rx-print-sheet` class in index.css is what keeps the dashboard behind it
 * off the paper.
 */

interface PackingSlipModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: Order | null;
}

export default function PackingSlipModal({ isOpen, onClose, order }: PackingSlipModalProps) {
  const [preview, setPreview] = useState<{
    fileUrl?: string;
    fileName?: string;
    fileType?: string;
    widthCm?: number;
    heightCm?: number;
    productName?: string;
    previews?: Array<{ side: 'front' | 'back'; url: string }> | null;
    thumb?: string | null;
  } | null>(null);
  // The products' own photos for lines that did not freeze one (older orders).
  const productImages = useProductImages(isOpen ? (order?.items as any[]) : null);

  if (!isOpen || !order) return null;

  // THE PICTURE OF EACH ITEM, BIG (client, 2026-10-07: "the product's picture must
  // be visible and very big") — beside the item it belongs to, not one small box
  // at the foot for the first line only. A line with a product CAN have one: its
  // photo may come from the catalogue a moment later, and the slip must not gain a
  // column (and lose its foot box) when it lands.
  const anyPicture = (order.items ?? []).some((it: any) => pictureOf(it, productImages) || it?.productId);
  const pictureSize = slipPictureSize((order.items ?? []).length);

  const c: any = (order as any).customerDetails ?? {};
  const isPickup = order.shippingMethod === 'pickup';

  /**
   * Where the box goes. Falls back through every shape an address has ever been
   * stored in on this shop — orders written before `customerDetails` existed
   * still have to produce a slip somebody can post.
   *
   * A COLLECTION prints who is coming to fetch the job, not where they live: a
   * street address under the words "Collection by customer" is the kind of thing
   * a packer reads as a delivery address and puts on a label.
   *
   * The customer's own words are printed EXACTLY as they typed them, in whatever
   * script they typed them in. This shop's own text is English, Swedish, Danish
   * and Norwegian — an address is not the shop's text, and "correcting" one is
   * how a parcel goes to the wrong place.
   */
  // THE DELIVERY address when the customer gave a separate one — this slip
  // printed the billing address even then (src/lib/deliveryAddress.ts).
  const dest = deliveryAddressOf(order);
  const deliveryLines: string[] = (isPickup
    ? [c.company || c.companyName, order.customerName]
    : [
        dest.company,
        dest.name,
        dest.address1,
        dest.address2,
        [dest.postcode, dest.city].filter(Boolean).join(' '),
        dest.country || 'Sweden',
      ]
  ).filter((line: unknown): line is string => typeof line === 'string' && line.trim() !== '');

  const phone = c.phone || order.shippingAddress?.phone;

  /**
   * The carrier, the way the supplier's slip prints it: an own-fleet token when
   * the shop delivers or the customer collects, otherwise the human name of the
   * method the customer actually paid for.
   */
  const carrier = isPickup
    ? 'CUSTOMER COLLECTION'
    : (order.shippingMethodTitle || order.shippingMethod || 'OWN_CARRIER_REKLAMX');

  /** Total pieces in the box — the number the packer counts against. */
  const totalUnits = (order.items ?? []).reduce((sum, item: any) => sum + (Number(item?.quantity) || 0), 0);

  /** The despatch day, shouted at the bottom exactly like the reference slip. */
  const dispatchDate = order.dueDate ? `${order.dueDate}T12:00:00` : order.createdAt;

  /** The first line's artwork, printed small at the foot so the packer can eyeball the job. */
  const firstArtwork = (order.items ?? [])
    .map((item: any) => ({
      fileUrl: item?.fileSpecs?.fileUrl || item?.fileUrl || item?.designData,
      fileName: item?.fileSpecs?.fileName || item?.fileName,
      fileType: item?.fileSpecs?.fileType || 'PDF',
      // 15.6.6 — both axes from the same rule; see printSizeOf.
      widthCm: printSizeOf(item)?.widthCm,
      heightCm: printSizeOf(item)?.heightCm,
      productName: item?.productName,
      // A studio design's page pictures: the slip shows its first page, never the print file.
      previews: Array.isArray(item?.fileSpecs?.previews) ? item.fileSpecs.previews : null,
      thumb: previewOf(item?.fileSpecs),
    }))
    .find((a) => a.fileUrl);
  /**
   * With no file to show, the foot says WHY: a line still owes the customer's file
   * (amber), or the shop makes the artwork itself — a reprint, the studio (sky).
   * A finished-goods order has nothing to supply and says nothing; it used to be
   * told "No artwork supplied yet", right beside the line that said "REPRINT".
   */
  const artworkOwed = (order.items ?? []).some((item: any) => item?.artworkPending === true);
  const shopArtwork = (order.items ?? []).find((item: any) => item?.artworkSource === 'reprint' || item?.artworkSource === 'studio')
    ?.artworkSource as 'reprint' | 'studio' | undefined;

  const handlePrint = () => window.print();

  return (
    <AnimatePresence>
      <div
        key={`packing-slip-${order.id}`}
        className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/75 backdrop-blur-md overflow-y-auto print:p-0 print:bg-white print:static print:inset-auto"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="bg-white rounded-3xl max-w-4xl w-full max-h-[92vh] overflow-y-auto shadow-2xl border border-gray-200 print:shadow-none print:border-none print:max-h-none print:rounded-none text-gray-900"
          dir="ltr"
        >
          {/* Action bar — never printed. */}
          <div className="bg-slate-900 text-white p-4 sm:px-8 sm:py-4 flex items-center justify-between sticky top-0 z-20 print:hidden border-b border-slate-800">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-black shadow-md">
                <Package className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <h3 className="font-extrabold text-base">Packing slip / Delivery note</h3>
                  <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[0.625rem] font-black px-2 py-0.5 rounded-full uppercase">
                    Goes in the box — no prices
                  </span>
                </div>
                <p className="text-xs text-gray-400 font-mono">Order #{order.id}</p>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={handlePrint}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-black px-4 py-2 rounded-xl text-xs flex items-center space-x-1.5 transition-all shadow-md active:scale-95 cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>Print / Save as PDF</span>
              </button>
              <button
                onClick={onClose}
                className="p-2 text-gray-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* ---------- THE SHEET ---------- */}
          <div className="rx-print-sheet p-6 sm:p-10 bg-white space-y-5" id="printable-packing-slip">
            {/* Barcode, centred, the order number under it — the first thing the
                warehouse scans and the last thing anybody should have to read. */}
            <div className="flex flex-col items-center pb-2">
              <Barcode value={order.id} narrow={2} height={64} />
            </div>

            <div className="grid grid-cols-1 @lg:grid-cols-[1fr_2fr] gap-8">
              {/* LEFT — where it goes, who carries it. */}
              <div className="space-y-5 text-xs">
                <div>
                  <p className="text-slate-400 font-black uppercase tracking-wider text-[0.625rem] mb-1">
                    {isPickup ? 'Collection by customer' : 'Delivery Address'}
                  </p>
                  {deliveryLines.map((line, i) => (
                    <p key={i} className="font-bold text-slate-800 leading-relaxed">
                      {line}
                    </p>
                  ))}
                  {phone && <p className="font-black text-slate-900 mt-1">{phone}</p>}
                  {c.taxId && <p className="font-bold text-slate-500">{c.taxId}</p>}
                </div>

                <div>
                  <p className="text-slate-400 font-black uppercase tracking-wider text-[0.625rem]">Order Number</p>
                  <p className="font-mono font-black text-slate-900 text-sm">{order.id}</p>
                </div>

                <div>
                  <p className="text-slate-400 font-black uppercase tracking-wider text-[0.625rem]">Carrier</p>
                  <p className="font-black text-slate-900 uppercase leading-tight">{carrier}</p>
                </div>

                <div>
                  <p className="text-slate-400 font-black uppercase tracking-wider text-[0.625rem]">Order date</p>
                  <p className="font-bold text-slate-800">{formatDateTime(order.createdAt)}</p>
                </div>

                <div>
                  <p className="text-slate-400 font-black uppercase tracking-wider text-[0.625rem]">Pieces in this delivery</p>
                  <p className="font-black text-slate-900 text-sm">{totalUnits}</p>
                </div>
              </div>

              {/* RIGHT — what is in the box, in the customer's own words. */}
              <div>
                <div className="grid grid-cols-[1fr_auto] bg-slate-700 text-white text-[0.6875rem] font-black uppercase tracking-wider">
                  <div className="px-4 py-2">Items to be delivered</div>
                  <div className="px-4 py-2 text-right">SKU</div>
                </div>

                {(order.items ?? []).map((item: any, i: number) => {
                  const fileName = item?.fileSpecs?.fileName || item?.fileName;
                  const fileType = item?.fileSpecs?.fileType || 'PDF';
                  const size = printSizeOf(item);
                  const w = size?.widthCm ?? 0;
                  const h = size?.heightCm ?? 0;

                  const picture = pictureOf(item, productImages);
                  const fileUrl = item?.fileSpecs?.fileUrl || item?.fileUrl || item?.designData;
                  // What the customer sent, when it cannot be drawn here (AI, EPS…).
                  const typeWord = String(item?.fileSpecs?.fileType || /\.([a-z0-9]{1,5})$/i.exec(String(fileName ?? ''))?.[1] || '').toUpperCase();
                  return (
                    <div
                      key={i}
                      className="grid gap-4 px-4 py-2 border-b border-slate-200 text-xs align-top rx-keep"
                      style={{ gridTemplateColumns: anyPicture ? `${pictureSize}px 1fr auto` : '1fr auto' }}
                    >
                      {anyPicture && (
                        <button
                          type="button"
                          onClick={() =>
                            fileUrl &&
                            setPreview({
                              fileUrl,
                              fileName,
                              fileType,
                              widthCm: w || undefined,
                              heightCm: h || undefined,
                              productName: item?.productName,
                              previews: Array.isArray(item?.fileSpecs?.previews) ? item.fileSpecs.previews : null,
                              thumb: previewOf(item?.fileSpecs),
                            })
                          }
                          className="relative rounded-lg border border-slate-300 bg-white overflow-hidden flex items-center justify-center print:cursor-default"
                          style={{ width: pictureSize, height: pictureSize }}
                          title="Open the artwork"
                          data-rx-slip-picture={picture?.kind ?? 'none'}
                        >
                          {/* Always labelled: with a file that cannot be drawn, the product's
                              photo stands in for it — and must never pass for the artwork. */}
                          {picture ? (
                            <LinePictureView source={picture} label="Product photo" fileBadge={fileUrl ? `${typeWord || 'Their'} file` : undefined} />
                          ) : (
                            <FileText className="w-6 h-6 text-slate-300" />
                          )}
                        </button>
                      )}
                      <div>
                        <p className="font-black text-slate-900 text-sm">{item.productName}</p>
                        <div className="mt-0.5 space-y-0.5 text-slate-700 font-medium leading-snug">
                          {/* The count, the size and the file first, on one line —
                              what the packer checks against the box. */}
                          <p>
                            <span className="font-black text-slate-900">Quantity: {item.quantity}</span>
                            {w > 0 && h > 0 && <> · Print size: {w} × {h} cm</>}
                            {item?.artworkSource === 'reprint' ? (
                              <> · <span className="font-black">REPRINT — previous order&rsquo;s artwork</span></>
                            ) : item?.artworkSource === 'studio' ? (
                              <> · <span className="font-black">STUDIO DESIGN — made by the shop</span></>
                            ) : fileName ? (
                              <> · Artwork file: <span className="font-black">{fileName}</span> ({fileType})</>
                            ) : item?.artworkPending ? (
                              <> · <span className="font-black text-amber-800">ARTWORK NOT SUPPLIED YET</span></>
                            ) : null}
                          </p>
                          {/* EVERY choice the customer made — including the
                              sub-options, which arrive here already flattened into
                              the order's option map — as one flowing paragraph. One
                              per line made a 15-line order three sheets long; the
                              client asked for one. */}
                          {Object.keys(item.options ?? {}).length > 0 && (
                            <p>
                              {Object.entries(item.options ?? {})
                                .map(([label, value]) => `${label}: ${
                                  typeof value === 'object' && value !== null
                                    ? String((value as any).label ?? (value as any).value ?? '')
                                    : String(value)
                                }`)
                                .join(' · ')}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="text-right whitespace-nowrap">
                        <p className="font-mono font-black text-slate-800">{item.sku || '—'}</p>
                        <p className="font-mono text-[0.625rem] text-slate-400 mt-0.5">Supplier SKU:</p>
                      </div>
                    </div>
                  );
                })}

                {order.notes && (
                  <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 font-semibold flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <span>
                      <span className="font-black uppercase text-[0.625rem] block">Customer instructions</span>
                      {order.notes}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* FOOT — the artwork small on the left, the despatch day shouted on
                the right, exactly the way the reference slip lays it out. */}
            <div className="grid grid-cols-1 @lg:grid-cols-[auto_1fr] gap-6 items-end pt-4">
              <div>
                {/* With a picture beside each item, the foot only says why a file is
                    missing; without one, the first line's file as before. */}
                {firstArtwork && !anyPicture ? (
                  <button
                    type="button"
                    onClick={() => setPreview(firstArtwork)}
                    className="w-36 h-44 border border-slate-300 rounded-lg overflow-hidden bg-white flex items-center justify-center p-2 relative group print:cursor-default"
                    title="Open the artwork"
                  >
                    {firstArtwork.thumb ? (
                      <SafeImage loading="eager"
                        src={firstArtwork.thumb}
                        alt={firstArtwork.fileName || 'Artwork'}
                        className="max-h-full max-w-full object-contain"
                      />
                    ) : isDisplayableImage(firstArtwork.fileUrl, firstArtwork.fileName, firstArtwork.fileType) ? (
                      <SafeImage loading="eager"
                        src={firstArtwork.fileUrl}
                        alt={firstArtwork.fileName || 'Artwork'}
                        className="max-h-full max-w-full object-contain"
                      />
                    ) : (
                      <div className="text-center space-y-1 text-slate-500">
                        <FileText className="w-8 h-8 mx-auto text-slate-400" />
                        <span className="font-mono text-[0.625rem] font-bold block break-all px-1">
                          {firstArtwork.fileName}
                        </span>
                      </div>
                    )}
                    <span className="absolute inset-0 bg-slate-900/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-black print:hidden">
                      <ZoomIn className="w-4 h-4 mr-1" />
                      Open
                    </span>
                  </button>
                ) : artworkOwed ? (
                  <div className="w-36 h-44 border border-dashed border-amber-300 rounded-lg flex items-center justify-center text-center p-3 bg-amber-50">
                    <span className="text-[0.625rem] font-black text-amber-800 uppercase leading-tight">
                      No artwork
                      <br />
                      supplied yet
                    </span>
                  </div>
                ) : shopArtwork ? (
                  <div
                    data-rx-slip-shop-artwork={shopArtwork}
                    className="w-36 h-44 border border-dashed border-sky-300 rounded-lg flex items-center justify-center text-center p-3 bg-sky-50"
                  >
                    <span className="text-[0.625rem] font-black text-sky-800 uppercase leading-tight">
                      {shopArtwork === 'reprint' ? 'Reprint — previous order\u2019s artwork' : 'Studio design — made by us'}
                    </span>
                  </div>
                ) : null}
              </div>

              <div className="flex items-end gap-4">
                <span className="text-[0.6875rem] font-black uppercase tracking-wider text-slate-500 pb-2">
                  Dispatch:
                </span>
                <div className="flex-1 bg-emerald-600 text-white px-6 py-3 text-center rounded-sm">
                  <p className="text-3xl font-black tracking-tight leading-none">
                    {formatDispatchWeekday(dispatchDate)}
                  </p>
                  <p className="text-sm font-bold mt-1">{formatDate(dispatchDate)}</p>
                </div>
              </div>
            </div>

            <p className="text-[0.625rem] text-slate-400 font-bold text-center border-t border-slate-200 pt-3">
              Packing slip for order {order.id} — this document carries no prices. The invoice is issued separately.
            </p>
          </div>
        </motion.div>
      </div>

      {/* The artwork, full size, when somebody clicks the thumbnail. */}
      <DesignAttachmentModal
        key={`packing-slip-artwork-${order.id}`}
        isOpen={!!preview}
        onClose={() => setPreview(null)}
        fileUrl={preview?.fileUrl}
        fileName={preview?.fileName}
        fileType={preview?.fileType}
        widthCm={preview?.widthCm}
        heightCm={preview?.heightCm}
        productName={preview?.productName}
        orderId={order.id}
        previews={preview?.previews}
      />
    </AnimatePresence>
  );
}
