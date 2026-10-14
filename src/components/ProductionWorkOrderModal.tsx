import React, { useRef, useState } from 'react';
import { useAuth } from '../App';
import { motion, AnimatePresence } from 'motion/react';
import { X, Printer, Download, FileText, AlertCircle, ZoomIn } from 'lucide-react';
import { Order } from '../types';
import { triggerFileDownload } from '../lib/downloadHelper';
import DesignAttachmentModal from './DesignAttachmentModal';
import { LinePictureView, pictureOf, pictureSizeFor, useProductImages } from './LinePicture';
import Barcode from './Barcode';
import { priorityOf } from '../lib/orderQueue';
import { deliveryAddressOf } from '../lib/deliveryAddress';
import { printSizeOf, measuredLengthMismatch, measuredLengthText } from '../lib/printSize';
import { iconOutline, primaryOutline, type OutlineKind } from '../lib/shapes';

interface ProductionWorkOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: Order | null;
}

export default function ProductionWorkOrderModal({ 
  isOpen, 
  onClose, 
  order}: ProductionWorkOrderModalProps) {
  const { t } = useAuth();
  const printRef = useRef<HTMLDivElement>(null);
  const [selectedDesignItem, setSelectedDesignItem] = useState<{
    fileUrl?: string;
    fileName?: string;
    fileType?: string;
    widthCm?: number;
    heightCm?: number;
    productName?: string;
    previews?: Array<{ side: 'front' | 'back'; url: string }> | null;
  } | null>(null);
  // The products' own photos for lines that did not freeze one (older orders).
  const productImages = useProductImages(isOpen ? (order?.items as any[]) : null);

  if (!isOpen || !order) return null;

  // The picture column: big for one job, smaller as they add up (one A4 page) —
  // and the old 3.5rem when no line can show anything (nothing to make room for).
  // "Can": a line with a product may get its photo from the catalogue a moment
  // later, and the sheet must not change shape when it lands.
  //
  // In REM, as the old w-14 box was: paper type is 12 px, so 3.5rem prints at 42 px.
  // The same box in pixels printed at 56, and a 17-line sheet ran onto a second page.
  const anyPicture = (order.items ?? []).some((it: any) => pictureOf(it, productImages) || it?.productId);
  const pictureColumn = `${(anyPicture ? pictureSizeFor((order.items ?? []).length) : 56) / 16}rem`;

  const workOrderYear = new Date(order.createdAt).getFullYear() || new Date().getFullYear();
  const jobTicketNumber = `WO-${workOrderYear}-${order.id.replace(/^ORD-/, '').replace(/^ORD/, '')}`;
  
  // Dates
  const createdDateObj = new Date(order.createdAt);
  const orderDateFormatted = createdDateObj.toLocaleDateString('sv-SE', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  /**
   * The promised date.
   *
   * This used to be `createdAt + 3 days`, computed inside this component — a
   * number no one could change, that the customer never saw, and that had
   * nothing to do with how long the shop actually takes. The order now carries
   * `dueDate`, written by the server from the owner's own lead times and movable
   * by staff on the order card. The old arithmetic survives only as a fallback
   * for orders placed before that existed.
   */
  const fmtDate = (d: Date) =>
    d.toLocaleDateString('sv-SE', { year: 'numeric', month: 'short', day: 'numeric' });

  const dueDateFormatted = (order as any).dueDate
    ? fmtDate(new Date(`${(order as any).dueDate}T12:00:00`))
    : fmtDate(new Date(createdDateObj.getTime() + 3 * 24 * 60 * 60 * 1000));
  const dueDateIsEstimate = !(order as any).dueDate;

  /** Where this job is going, as an address block. */
  const c: any = order.customerDetails ?? {};
  const isPickup = order.shippingMethod === 'pickup';
  // The separate delivery address when there is one (src/lib/deliveryAddress.ts).
  const dest = deliveryAddressOf(order);
  const deliveryLines = [
    dest.company,
    dest.name,
    dest.address1,
    dest.address2,
    [dest.postcode, dest.city].filter(Boolean).join(' '),
    dest.country || 'Sweden',
  ].filter((line: unknown) => typeof line === 'string' && String(line).trim());

  const handlePrint = () => {
    window.print();
  };

  return (
    // AnimatePresence tracks its children BY KEY, and this one had none. On a
    // re-render it therefore held the outgoing and incoming copies as two
    // children whose keys were both "", which React reports as a duplicate-key
    // error every time the sheet is opened. Keying it by the order also makes
    // switching straight from one order's sheet to another's animate properly
    // instead of mutating the open one in place.
    <AnimatePresence>
      <div
        key={`work-order-${order.id}`}
        className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/75 backdrop-blur-md overflow-y-auto print:p-0 print:bg-white print:static print:inset-auto"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="bg-white rounded-3xl max-w-4xl w-full max-h-[92vh] overflow-y-auto shadow-2xl border border-gray-200 print:shadow-none print:border-none print:max-h-none print:rounded-none text-gray-900"
          dir={'ltr'}
        >
          {/* Modal Top Action Bar (Hidden on Print) */}
          <div className="bg-slate-900 text-white p-4 sm:px-8 sm:py-4 flex items-center justify-between sticky top-0 z-20 print:hidden border-b border-slate-800">
            <div className="flex items-center space-x-3 space-x-reverse">
              <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center font-black shadow-md">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center space-x-2 space-x-reverse">
                  <h3 className="font-extrabold text-base">
                    {'A4 Employee Production Work Order'}
                  </h3>
                  <span className="bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[0.625rem] font-black px-2 py-0.5 rounded-full uppercase">
                    {'PRODUCTION ONLY - NO PRICES'}
                  </span>
                </div>
                <p className="text-xs text-gray-400 font-mono">
                  Ticket #{jobTicketNumber} • Order: #{order.id}
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-2 space-x-reverse">
              <button
                onClick={handlePrint}
                className="bg-blue-600 hover:bg-blue-500 text-white font-black px-4 py-2 rounded-xl text-xs flex items-center space-x-1.5 space-x-reverse transition-all shadow-md active:scale-95 cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>{'Print A4 Work Order'}</span>
              </button>

              <button
                onClick={onClose}
                className="p-2 text-gray-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* PRINTABLE A4 WORK ORDER — ONE PAGE (the client's item 7).
              It used to print every item twice (a picking list, then an
              "artwork & specs" card per item with the same options), the
              address twice, the carrier three times, a 144 px dark thumbnail
              tile per item and a "CMYK 300 DPI" box that was printed on every
              order whether or not anyone had checked the file. Now each fact
              is printed once and each job is one compact row; what is left
              still overflowing is zoomed to one page (src/lib/printFit.ts). */}
          <div ref={printRef} className="rx-print-sheet p-6 sm:p-8 space-y-4 bg-white" id="printable-work-order">

            {/* Header */}
            <div className="flex justify-between items-start border-b-2 border-slate-900 pb-3 gap-4">
              <div>
                <span className="px-2 py-0.5 bg-slate-900 text-white text-[0.625rem] font-black rounded uppercase tracking-wider">
                  REKLAMX PRODUCTION TICKET
                </span>
                <h1 className="text-xl font-black text-slate-900 tracking-tight pt-1">Production Work Order</h1>
                <p className="text-[0.625rem] text-slate-500 font-bold">Pre-press, printing, finishing and packing — no prices.</p>
              </div>
              <div className="text-right">
                <span className="font-mono font-black text-base text-slate-900 block">{jobTicketNumber}</span>
                <span className="text-xs font-bold text-blue-700 block">Order #{order.id}</span>
                {/* What the staff set in the queue: how urgent, and which day it
                    goes on the press. */}
                {priorityOf(order) !== 'normal' && (
                  <span className={
                    priorityOf(order) === 'urgent'
                      ? 'mt-1 inline-block px-2 py-0.5 rounded-md bg-red-600 text-white text-[0.6875rem] font-black uppercase'
                      : 'mt-1 inline-block px-2 py-0.5 rounded-md bg-orange-100 text-orange-900 text-[0.6875rem] font-black uppercase'
                  }>
                    {priorityOf(order) === 'urgent' ? 'URGENT' : 'HIGH PRIORITY'}
                  </span>
                )}
                {order.printDate && (
                  <span className="text-xs font-black text-indigo-800 block">Print date: {order.printDate}</span>
                )}
              </div>
            </div>

            {/* DELIVERY NOTE — barcode, where it goes, who carries it. The one
                place the address, the phone and the carrier are printed. */}
            <div className="grid grid-cols-[auto_1fr] gap-4 items-start border border-slate-300 rounded-xl p-3 rx-keep">
              {/* A scanner reads this: real size whatever the page zoom, with the
                  quiet zone Code 39 asks for — ten narrow bars (20 px) clear on
                  each side. Shrunk with the sheet it fell below both. */}
              <div className="rx-unzoom px-[1.25rem] bg-white">
                <Barcode value={order.id} narrow={2} height={48} />
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-[0.625rem] font-black uppercase tracking-wider text-slate-400 block">
                    {isPickup ? 'Collection by customer' : 'Delivery address'}
                  </span>
                  {deliveryLines.map((line: string, i: number) => (
                    <p key={i} className={i === 0 ? 'font-black text-slate-900' : 'font-bold text-slate-700'}>
                      {line}
                    </p>
                  ))}
                  {(c.phone || order.shippingAddress?.phone) && (
                    <p className="font-black text-blue-800">{c.phone || order.shippingAddress?.phone}</p>
                  )}
                  {order.customerEmail && <p className="font-bold text-slate-500">{order.customerEmail}</p>}
                </div>
                <div className="text-right space-y-1">
                  <div>
                    <span className="text-[0.625rem] font-black uppercase tracking-wider text-slate-400 block">Carrier</span>
                    {/* Prose, not the supplier note's carrier token: this sheet
                        is read by a picker, not a parser. */}
                    <span className="font-bold text-slate-800">
                      {isPickup ? 'Own collection — customer picks up' : order.shippingMethodTitle || order.shippingMethod || '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[0.625rem] font-black uppercase tracking-wider text-slate-400 block">Customer</span>
                    <span className="font-bold text-slate-800 block">{order.customerName}</span>
                    {/* The buyer's company, when the parcel goes to someone else's
                        address (otherwise it is the first address line already). */}
                    {dest.separate && String(c.company || c.companyName || '').trim() && (
                      <span className="font-bold text-slate-600 block">{c.company || c.companyName}</span>
                    )}
                    {/* The billing address too, when the parcel goes elsewhere —
                        the sheet used to print it in a box of its own. */}
                    {dest.separate && (
                      <span className="font-medium text-slate-500 block">
                        {[c.address1, [c.postcode, c.city].filter(Boolean).join(' '), c.country].filter(Boolean).join(', ')}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Dates — received, on the press, promised. */}
            <div className="grid grid-cols-3 gap-3 bg-slate-50 px-3 py-2 rounded-xl border border-slate-200 text-xs rx-keep">
              <div>
                <span className="text-slate-500 font-bold uppercase text-[0.625rem] block">Received</span>
                <span className="font-extrabold text-slate-900">{orderDateFormatted}</span>
              </div>
              <div>
                <span className="text-slate-500 font-bold uppercase text-[0.625rem] block">Print date</span>
                <span className="font-extrabold text-indigo-900">{order.printDate || '—'}</span>
              </div>
              <div>
                <span className="text-slate-500 font-bold uppercase text-[0.625rem] block">
                  {dueDateIsEstimate ? 'Delivery (estimated)' : 'Promised delivery'}
                </span>
                <span className="font-extrabold text-emerald-900">{dueDateFormatted}</span>
              </div>
            </div>

            {order.notes && (
              <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl text-xs rx-keep">
                <span className="font-black text-amber-900 uppercase text-[0.625rem] flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                  Customer note
                </span>
                <p className="text-amber-950 font-bold leading-snug whitespace-pre-wrap">{order.notes}</p>
              </div>
            )}

            {/* THE JOBS — one row each: the file, what to make, how many, how big,
                and every option the customer chose. */}
            <div className="border border-slate-300 rounded-xl overflow-hidden">
              <div className="grid gap-3 bg-slate-800 text-white text-[0.625rem] font-black uppercase tracking-wider px-3 py-1.5" style={{ gridTemplateColumns: `${pictureColumn} 1fr auto` }}>
                <span>File</span>
                <span>Job — {(order.items ?? []).length} item{(order.items ?? []).length === 1 ? '' : 's'}</span>
                <span className="text-right">Qty</span>
              </div>
              {(order.items ?? []).map((item: any, index: number) => {
                // The name the customer's file really has — printed only when
                // there is one. The fallback is for the download dialog alone.
                const realName: string = item.fileSpecs?.fileName || '';
                const fileName = realName || 'Uploaded_Artwork_File.pdf';
                const fileType = item.fileSpecs?.fileType || 'PDF';
                // 15.6.6 — one rule for the size, from src/lib/printSize.ts.
                const printed = printSizeOf(item);
                const widthCm = printed?.widthCm ?? 0;
                const heightCm = printed?.heightCm ?? 0;
                const fileUrl = item.fileSpecs?.fileUrl || item.designData;
                // A studio design brings a small picture of each page: the sheet shows
                // that, never the print file itself (a two-sided roll-up PDF is 40 MB).
                const pages: Array<{ side: 'front' | 'back'; url: string }> = Array.isArray(item.fileSpecs?.previews) ? item.fileSpecs.previews : [];
                const sides: Array<'front' | 'back'> = Array.isArray(item.fileSpecs?.sides) ? item.fileSpecs.sides : [];
                const options = Object.entries(item.options ?? {}).map(([label, value]) =>
                  `${label}: ${typeof value === 'object' && value !== null ? String((value as any).label ?? (value as any).value ?? '') : String(value)}`);
                const picture = pictureOf(item, productImages);
                // What the customer sent, when it cannot be drawn here (AI, EPS…).
                const typeWord = String(item.fileSpecs?.fileType || /\.([a-z0-9]{1,5})$/i.exec(realName)?.[1] || '').toUpperCase();
                return (
                  <div key={index} className="grid gap-3 px-3 py-2 border-t border-slate-200 text-xs items-start rx-keep" style={{ gridTemplateColumns: `${pictureColumn} 1fr auto` }}>
                    {/* THE PICTURE, BIG (client, 2026-10-07) — the design, the customer's
                        picture or the first page of their PDF, else the product's photo. */}
                    <button
                      type="button"
                      onClick={() => fileUrl && setSelectedDesignItem({ fileUrl, fileName, fileType, widthCm, heightCm, productName: item.productName, previews: pages })}
                      className="relative rounded-lg border border-slate-200 bg-slate-50 overflow-hidden flex items-center justify-center cursor-pointer"
                      style={{ width: pictureColumn, height: pictureColumn }}
                      title="Click to view full screen design"
                      data-rx-sheet-picture={picture?.kind ?? 'none'}
                    >
                      {picture ? (
                        // Always labelled: with a file that cannot be drawn, the product's
                        // photo stands in for it — and must never pass for the artwork.
                        <LinePictureView source={picture} label="Product photo" fileBadge={fileUrl ? `${typeWord || 'Their'} file` : undefined} designAttr />
                      ) : fileUrl ? (
                        <span className="text-[0.5625rem] font-black text-slate-500 uppercase">{fileType}</span>
                      ) : (
                        <span className="text-[0.5rem] font-black text-amber-700 text-center leading-tight px-0.5">NO FILE</span>
                      )}
                      {picture && !fileUrl && (
                        <span className="absolute top-0 inset-x-0 bg-amber-100/90 text-[0.5rem] font-black text-amber-800 text-center py-0.5">NO FILE</span>
                      )}
                    </button>
                    <div className="min-w-0">
                      <p className="font-black text-slate-900">
                        {index + 1}. {item.productName}
                        {item.sku ? <span className="font-mono font-bold text-slate-500"> · {item.sku}</span> : null}
                        {/* THE CUT, where the cutter looks first — round 16, item 4.
                            Only a real shape (a plain rectangle is the default
                            trim), and only on orders that recorded one. */}
                        {(() => {
                          const shapes: Array<{ outline: OutlineKind; label: string }> =
                            Array.isArray(item.shapes) ? item.shapes : [];
                          const cut = primaryOutline(shapes);
                          if (!cut || cut === 'rect') return null;
                          const label = shapes.find((sh) => sh.outline === cut)?.label ?? cut;
                          const icon = iconOutline(cut, 16);
                          return (
                            <span className="inline-flex items-center gap-1 ml-2 px-1.5 py-0.5 rounded-md bg-orange-50 border border-orange-200 text-orange-900 align-middle" data-rx-cut={cut}>
                              <svg viewBox="0 0 20 20" className="w-4 h-4" aria-hidden="true">
                                <path d={icon.d} transform={`translate(${2 + icon.dx} ${2 + icon.dy})`} fill="none" stroke="currentColor" strokeWidth={1.6} strokeDasharray={cut === 'custom' ? '3 2' : undefined} />
                              </svg>
                              <span className="text-[0.6875rem] font-black">Cut: {label}</span>
                            </span>
                          );
                        })()}
                      </p>
                      <p className="font-bold text-slate-700">
                        {[widthCm > 0 && heightCm > 0 ? `${widthCm} × ${heightCm} cm` : '', fileUrl ? realName : '']
                          .filter(Boolean)
                          .join(' · ')}
                        {/* PAY-05: a custom upload whose file is not the length he paid
                            for — "Paid 50 cm — the file measures 300 cm". Beside the
                            size, where the operator reads it before he prints. */}
                        {(() => {
                          const measured = measuredLengthMismatch(item);
                          return measured ? (
                            <span className="ml-1.5 px-1.5 py-0.5 rounded bg-amber-100 border border-amber-400 text-[0.625rem] font-black text-amber-900" data-rx-measured-length>
                              {measuredLengthText(measured)}
                            </span>
                          ) : null;
                        })()}
                        {/* Round 16: a file may carry the shop's 3 mm bleed (the
                            online designer's always does). Placed at the size
                            above, its edge would be printed as part of the job. */}
                        {fileUrl && item.fileSpecs?.template && (
                          <span className="ml-1.5 text-[0.625rem] font-black text-slate-600" data-rx-file-template>
                            · Template: {String(item.fileSpecs.template)}
                          </span>
                        )}
                        {fileUrl && Number(item.fileSpecs?.bleedMm) > 0 && (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded bg-slate-100 border border-slate-300 text-[0.625rem] font-black text-slate-800" data-rx-file-bleed>
                            File includes {Number(item.fileSpecs.bleedMm)} mm bleed — trim to the size
                          </span>
                        )}
                        {/* A PDF/X with crop marks: its page is bigger than the product, and
                            only its own box says where the product is (src/lib/pdfBoxes.ts). */}
                        {fileUrl && (item.fileSpecs?.placeBy === 'trimbox' || item.fileSpecs?.placeBy === 'bleedbox') && (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded bg-slate-100 border border-slate-300 text-[0.625rem] font-black text-slate-800" data-rx-file-placeby>
                            Crop marks — place by the file&rsquo;s {item.fileSpecs.placeBy === 'trimbox' ? 'TrimBox' : 'BleedBox'}
                            {Number(item.fileSpecs?.pageWidthMm) > 0 && Number(item.fileSpecs?.pageHeightMm) > 0
                              ? ` (the page with marks is ${Math.round(Number(item.fileSpecs.pageWidthMm))} × ${Math.round(Number(item.fileSpecs.pageHeightMm))} mm)`
                              : ''}
                          </span>
                        )}
                        {/* A studio design's pages, in the order the file holds them. */}
                        {fileUrl && sides.length > 1 && (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded bg-slate-100 border border-slate-300 text-[0.625rem] font-black text-slate-800" data-rx-file-pages>
                            {sides.map((sd, i) => `Page ${i + 1} ${sd === 'back' ? 'Back' : 'Front'}`).join(' / ')}
                          </span>
                        )}
                      </p>
                      {options.length > 0 && (
                        <p className="text-slate-700 font-medium leading-snug">{options.join(' · ')}</p>
                      )}
                      {item.artworkPending && (
                        <p className="font-black text-amber-800">ARTWORK NOT SUPPLIED YET</p>
                      )}
                      {/* The shop provides this line's artwork — the customer was never asked for it. */}
                      {(item as any).artworkSource === 'reprint' && (
                        <p className="font-black text-sky-800" data-rx-artwork-source="reprint">
                          REPRINT — use the artwork from the customer&rsquo;s previous order
                        </p>
                      )}
                      {(item as any).artworkSource === 'studio' && (
                        <p className="font-black text-sky-800" data-rx-artwork-source="studio">
                          STUDIO DESIGN — our designer creates the artwork
                          {fileUrl ? '; the attached file is the customer\u2019s material, not the print file' : ''}
                        </p>
                      )}
                      {fileUrl && (
                        <span className="flex items-center gap-3 mt-1 print:hidden">
                          <button
                            type="button"
                            onClick={() => setSelectedDesignItem({ fileUrl, fileName, fileType, widthCm, heightCm, productName: item.productName, previews: pages })}
                            className="text-[0.6875rem] text-blue-700 hover:text-blue-900 font-extrabold flex items-center gap-1 cursor-pointer"
                          >
                            <ZoomIn className="w-3.5 h-3.5" />
                            <span>Large Preview</span>
                          </button>
                          <button
                            type="button"
                            // The order and line in front: two designs of the same
                            // size have the same name, and the second download
                            // landed on top of the first.
                            onClick={() => triggerFileDownload(fileUrl, `${order.id}-${index + 1}_${fileName}`)}
                            className="text-[0.6875rem] text-slate-600 hover:text-slate-900 font-bold flex items-center gap-1 cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>{t('commonDownload')}</span>
                          </button>
                        </span>
                      )}
                    </div>
                    <span className="text-base font-black text-blue-700 tabular-nums whitespace-nowrap">{item.quantity} pcs</span>
                  </div>
                );
              })}
            </div>

            {/* Sign-off — one row, at REAL size whatever the page zoom
                (rx-fullsize): a signature or a stamp needs about 12 mm, and a
                box zoomed with the sheet came down to 2 mm. */}
            <div className="grid grid-cols-4 gap-2 text-[0.625rem] rx-keep rx-fullsize">
              {['1. Pre-press & files', '2. Printing', '3. Cutting & finishing', '4. Packing & dispatch'].map((label) => (
                <div key={label} className="border border-slate-200 rounded-lg px-2 pt-1 pb-0.5">
                  <span className="font-bold text-slate-700 block">{label}</span>
                  <span className="block h-[12mm] border-b border-dashed border-slate-300" />
                  <span className="text-slate-400 block">Sign / stamp</span>
                </div>
              ))}
            </div>

            <p className="text-[0.5625rem] text-slate-400 font-medium text-center">
              © {workOrderYear} ReklamX AB · Internal production document · {jobTicketNumber} · no financial data
            </p>
          </div>
        </motion.div>
      </div>

      {/* Large Image Attachment Preview Lightbox Modal */}
      <DesignAttachmentModal
        isOpen={!!selectedDesignItem}
        onClose={() => setSelectedDesignItem(null)}
        fileUrl={selectedDesignItem?.fileUrl}
        fileName={selectedDesignItem?.fileName}
        fileType={selectedDesignItem?.fileType}
        widthCm={selectedDesignItem?.widthCm}
        heightCm={selectedDesignItem?.heightCm}
        productName={selectedDesignItem?.productName}
        orderId={order.id}
        previews={selectedDesignItem?.previews}
      />
    </AnimatePresence>
  );
}
