import React, { useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, 
  Printer, 
  Download, 
  CheckCircle2, 
  Building2, 
  FileText, 
  MapPin, 
  Phone, 
  Mail, 
  Calendar,
  ShieldCheck,
  PackageCheck,
  Receipt
} from 'lucide-react';
import { Order } from '../types';
import { formatCurrency } from '../lib/utils';
import { logoSrc } from '../lib/brandLogo';
import { useSiteSettings } from '../context/SiteSettingsContext';
import { useAuth } from '../App';
import LineChargesNote from './LineChargesNote';
import { isOnDeliveryOpen, knownStageLabelKey, paymentTitleOf } from '../lib/orderQueue';
import { orderMoney } from '../lib/orderMoney';

interface InvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: Order | null;
}

export default function InvoiceModal({ isOpen, onClose, order}: InvoiceModalProps) {
  const printRef = useRef<HTMLDivElement>(null);
  const { settings } = useSiteSettings();
  const { t } = useAuth();

  if (!isOpen || !order) return null;

  // The year comes from the order, not from a literal. Hardcoding 2026 meant an
  // order reopened in a later year still printed the wrong invoice year.
  const invoiceYear = new Date(order.createdAt).getFullYear() || new Date().getFullYear();
  const invoiceNumber = `INV-${invoiceYear}-${order.id.replace(/^ORD-/, '').replace(/^ORD/, '')}`;
  const orderDate = new Date(order.createdAt).toLocaleDateString('sv-SE', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  // The day the shop promised, from the order — production plus transit, so it
  // is labelled "estimated delivery". This was `new Date()` under "Ready date",
  // the day the invoice happened to be opened, so every reprint differed.
  const dueDay = typeof order.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(order.dueDate) ? order.dueDate : null;
  const completionDate = dueDay
    ? new Date(`${dueDay}T12:00:00`).toLocaleDateString('sv-SE', { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  // Money comes off the order document, which records the breakdown; orders
  // written before that fall back to deriving it (src/lib/orderMoney.ts — the
  // same function the receipt and the admin's order page use).
  const {
    shipping: shippingCost,
    points: pointsDiscount,
    coupon: couponDiscount,
    vatRate,
    currency,
    net: netAmount,
    vat: vatAmount,
    gross: totalAmount,
    goodsBeforeDiscounts,
  } = orderMoney(order);

  const isPaid = order.paymentStatus === 'paid';
  // Agreed to be paid on delivery: not "awaiting payment" as if a checkout were stuck.
  const onDelivery = isOnDeliveryOpen(order);
  const isRefunded = order.paymentStatus === 'refunded';

  /**
   * WHAT THE LAW REQUIRES THIS DOCUMENT TO SAY.
   *
   * A reverse-charge invoice must state that it is one. An invoice that simply
   * shows 0% VAT with no explanation is not a valid invoice, and the shop, not
   * the customer, carries that. The sentence is decided and frozen at order time
   * (src/lib/vatRegime.ts) so it still says what it said when it was issued, and
   * it is printed only when the shop actually charged that way — recording a
   * regime is not the same as applying it.
   */
  const vatNote = order.vatRegimeApplied === true ? (order.vatInvoiceNote || null) : null;

  /**
   * Credit notes issued against this invoice.
   *
   * An issued invoice cannot be edited or deleted under Swedish rules, so a
   * refund is a separate document — and the invoice has to point at it, or the
   * customer holds a paper saying they owe money that has since been given back.
   * Amounts come from the order's own running total; the numbers are the
   * documents themselves.
   */
  const creditNoteNumbers: string[] = Array.isArray(order.creditNoteNumbers) ? order.creditNoteNumbers : [];
  const refundedTotal = Number(order.refundedAmount) || 0;

  const buyerCompany = order.customerDetails?.company || order.customerDetails?.companyName || '';
  const buyerTaxId = order.customerDetails?.taxId || order.customerDetails?.taxNumber || '';

  // Seller identity comes from site settings. Anything the owner has not filled in
  // yet is shown as an obvious gap rather than a convincing invented value.
  const MISSING = t('docNotSet');
  const sellerName = settings.companyLegalName?.trim() || settings.siteName || 'ReklamX';
  const sellerAddress = settings.companyAddress?.trim() || MISSING;
  const sellerPhone = settings.contactPhone?.trim() || MISSING;
  const sellerEmail = settings.contactEmail?.trim() || MISSING;
  const sellerOrgNr = settings.orgNumber?.trim() || MISSING;
  const sellerVatNr = settings.vatNumber?.trim() || MISSING;
  // Unlike org.nr and VAT (legally required, so a gap must be LOUD), bankgiro
  // is optional on an invoice paid online — hide it when unset rather than
  // print "— not set —" to the customer.
  const sellerBankgiro = settings.bankgiro?.trim() || '';

  const handlePrint = () => {
    window.print();
  };

  const isOrderReady = ['finishing', 'shipped', 'completed', 'delivered'].includes(order.status);

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/70 backdrop-blur-md overflow-y-auto print:p-0 print:bg-white print:static print:inset-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="bg-white rounded-3xl max-w-4xl w-full max-h-[92vh] overflow-y-auto shadow-2xl border border-gray-200 print:shadow-none print:border-none print:max-h-none print:rounded-none text-gray-900"
          dir={'ltr'}
        >
          {/* Modal Top Action Bar (Hidden on Print) */}
          <div className="bg-gray-900 text-white p-4 sm:px-8 sm:py-5 flex items-center justify-between sticky top-0 z-20 print:hidden border-b border-gray-800">
            <div className="flex items-center space-x-3 space-x-reverse">
              <div className="w-10 h-10 rounded-xl bg-orange-600 text-white flex items-center justify-center font-black">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center space-x-2 space-x-reverse">
                  <h3 className="font-extrabold text-base">
                    {t('docInvoiceTitle')}
                  </h3>
                  <span className="bg-orange-500/20 text-orange-400 border border-orange-500/30 text-[0.625rem] font-black px-2 py-0.5 rounded-full uppercase">
                    {isOrderReady ? t('docStatusOrderReady') : t('docStatusInvoiceDraft')}
                  </span>
                </div>
                <p className="text-xs text-gray-400 font-mono">
                  {`#${invoiceNumber} • `}{t('docOrderId')}{`: #${order.id}`}
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-2 space-x-reverse">
              <button
                onClick={handlePrint}
                className="bg-orange-600 hover:bg-orange-500 text-white font-black px-4 py-2 rounded-xl text-xs flex items-center space-x-1.5 space-x-reverse transition-all shadow-md active:scale-95 cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>{t('docPrintSavePdf')}</span>
              </button>

              <button
                onClick={onClose}
                className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-xl transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* PRINTABLE INVOICE CONTENT */}
          <div ref={printRef} className="rx-print-sheet p-6 sm:p-10 space-y-5 bg-white" id="printable-invoice">
            {/* Header: Company & Invoice Info */}
            <div className="flex flex-col @lg:flex-row justify-between items-start gap-6 border-b border-gray-200 pb-5">
              {/* Left: Company Logo & Details */}
              <div className="space-y-3">
                <div className="flex items-center space-x-2.5 space-x-reverse">
                  {/* The owner's own logo when one is uploaded (the shop header's
                      rule); otherwise the initial of the seller's name. It was a
                      hard-coded "P" from a name the shop no longer has. Fixed
                      height, so the one-page measurement does not depend on
                      whether the picture has loaded yet. */}
                  {/* The wordmark alone (src/lib/brandLogo.ts): the name is in
                      it. The seller's LEGAL name is still on the document — in
                      the tax line and the footer — where an invoice needs it. */}
                  <img src={logoSrc(settings)} alt={sellerName} loading="eager" className="h-11 w-52 object-contain object-left" />
                </div>

                <div className="text-xs text-gray-600 space-y-1 font-medium">
                  <p className="flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                    {sellerAddress}
                  </p>
                  <p className="flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                    {sellerPhone}
                  </p>
                  <p className="flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                    {sellerEmail}
                  </p>
                  <p className="text-[0.6875rem] text-gray-500 font-mono pt-1">
                    {t('docOrgNrLabel')} {sellerOrgNr} | {t('docVatNrLabel')} {sellerVatNr}{sellerBankgiro ? ` | ${t('docBankgiroLabel')} ${sellerBankgiro}` : ''}
                  </p>
                </div>
              </div>

              {/* Right: Invoice Meta & Status */}
              <div className="text-right @lg:text-left space-y-2 border-r @lg:border-r-0 @lg:border-l border-gray-100 @lg:pl-6">
                <div className="inline-block bg-orange-50 border border-orange-200 text-orange-900 px-3 py-1 rounded-xl text-xs font-black uppercase tracking-wider mb-1">
                  {t('docBadgeTaxInvoice')}
                </div>
                <h1 className="text-2xl font-black font-mono text-gray-900">{invoiceNumber}</h1>
                
                <div className="text-xs text-gray-600 space-y-1 font-semibold">
                  <p><span className="text-gray-400">{t('docOrderId')}:</span> #{order.id}</p>
                  <p><span className="text-gray-400">{t('docInvoiceDate')}</span> {orderDate}</p>
                  {completionDate && (
                    <p><span className="text-gray-400">{t('docEstimatedDelivery')}</span> {completionDate}</p>
                  )}
                  {/* A stage the shop does not know is left out, not printed as
                      "Pending" on a customer's tax invoice. */}
                  {knownStageLabelKey(order.status) && (
                    <p><span className="text-gray-400">{t('docOrderStatus')}</span> <strong className="text-emerald-700 font-extrabold">{t(knownStageLabelKey(order.status)!)}</strong></p>
                  )}
                </div>
              </div>
            </div>

            {/* Customer & Shipping Details Grid */}
            <div className="grid grid-cols-1 @lg:grid-cols-2 gap-6 bg-gray-50/80 p-4 rounded-2xl border border-gray-200/80">
              {/* Customer / Billed To */}
              <div className="space-y-2">
                <span className="text-xs font-black text-orange-600 uppercase tracking-wider block flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5" />
                  {t('docBilledTo')}
                </span>
                <p className="text-base font-extrabold text-gray-900">{order.customerName}</p>
                {/* Checkout stores these as `company` / `taxId`. The invoice was
                    reading `companyName` / `taxNumber`, so a business buyer's name
                    and VAT number never appeared on their invoice. */}
                {buyerCompany && (
                  <p className="text-xs font-bold text-purple-800 bg-purple-50 px-2.5 py-0.5 rounded-md inline-block">
                    {buyerCompany}
                    {buyerTaxId && ` (${t('docBuyerTaxIdLabel')} ${buyerTaxId})`}
                  </p>
                )}
                <div className="text-xs text-gray-600 space-y-0.5 font-medium">
                  <p>{order.customerDetails?.address1 || t('docCustomerAddressFallback')}</p>
                  <p>{order.customerDetails?.postcode} {order.customerDetails?.city}, {order.customerDetails?.country || t('docCountryFallback')}</p>
                  <p className="font-mono text-gray-500">{order.customerEmail}</p>
                  {order.customerDetails?.phone && <p>{t('contactCardPhoneTitle')}: {order.customerDetails.phone}</p>}
                </div>
              </div>

              {/* Delivery & Payment Method */}
              <div className="space-y-2 border-t @lg:border-t-0 @lg:border-l border-gray-200 @lg:pl-6 pt-4 @lg:pt-0">
                <span className="text-xs font-black text-blue-600 uppercase tracking-wider block flex items-center gap-1.5">
                  <PackageCheck className="w-3.5 h-3.5" />
                  {t('docDeliveryAndPayment')}
                </span>
                <div className="text-xs text-gray-700 space-y-1.5 font-medium">
                  <p>
                    <strong className="text-gray-900">{t('docDeliveryMethod')}</strong>{' '}
                    {order.shippingMethodTitle || t('docShippingMethodFallback')}
                  </p>
                  <p>
                    <strong className="text-gray-900">{t('docPaymentMethod')}</strong>{' '}
                    {paymentTitleOf(order, t) || '\u2014'}
                  </p>
                  {isPaid ? (
                    <p className="flex items-center gap-1.5 text-emerald-700 font-extrabold">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span>{t('docPaymentStatusPaidInFull')}</span>
                    </p>
                  ) : isRefunded ? (
                    <p className="flex items-center gap-1.5 text-gray-700 font-extrabold">
                      <span>{t('docPaymentStatusRefunded')}</span>
                    </p>
                  ) : (
                    <p className="flex items-center gap-1.5 text-amber-800 font-extrabold">
                      <span>{onDelivery ? t('docPaymentStatusOnDelivery') : t('docPaymentStatusAwaiting')}</span>
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Line Items Table */}
            <div className="border border-gray-200 rounded-2xl overflow-hidden shadow-2xs">
              {/* Left to right like any invoice: the description reads from the
                  left, the money lines up on the right. It was text-right
                  throughout, so each product name sat flush right above options
                  that started on the left. */}
              <table className="w-full text-left text-xs" dir={'ltr'}>
                <thead>
                  <tr className="bg-gray-100/90 text-gray-800 font-black uppercase text-[0.6875rem] border-b border-gray-200">
                    <th className="px-3 py-2.5 text-center w-10">#</th>
                    <th className="px-3 py-2.5">{t('docColProductSpec')}</th>
                    <th className="px-3 py-2.5 text-center">{t('docColQty')}</th>
                    <th className="px-3 py-2.5 text-right">{t('docColUnitPriceExVat')}</th>
                    <th className="px-3 py-2.5 text-right">{t('docColLineTotal')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 font-semibold text-gray-800">
                  {(order.items ?? []).map((item, index) => {
                    // `unitPrice` and `price` are both stored net of VAT, and
                    // `price` is already the whole line. Dividing by 1.25 and
                    // re-multiplying by the quantity made every printed line wrong
                    // and stopped the lines from summing to the total.
                    const itemUnitPriceExVat = (Number(item.unitPrice) || 0).toFixed(2);
                    const itemLineTotalExVat = (Number(item.price) || 0).toFixed(2);

                    return (
                      <tr key={index} className="hover:bg-gray-50/50 align-top">
                        <td className="px-3 py-2 text-center font-mono text-gray-400 font-bold">{index + 1}</td>
                        <td className="px-3 py-2 space-y-0.5">
                          <span className="font-extrabold text-gray-900 block text-sm">{item.productName}</span>
                          
                          {/* File specs if custom print */}
                          {item.fileSpecs && (
                            <div className="flex flex-wrap items-center gap-2 text-[0.6875rem] text-gray-500 font-medium">
                              <span className="bg-blue-50 text-blue-800 font-bold px-2 py-0.5 rounded border border-blue-200/60 uppercase">
                                {item.fileSpecs.fileType}
                              </span>
                              {item.fileSpecs.widthCm && item.fileSpecs.heightCm ? (
                                <span>{item.fileSpecs.widthCm}×{item.fileSpecs.heightCm} cm</span>
                              ) : null}
                              <span>• {t('docFileLabel')} {item.fileSpecs.fileName}</span>
                            </div>
                          )}

                          {/* Print options — one flowing line, not a chip each:
                              six chips in a monospace face took two or three
                              lines per product and pushed a 5-line order onto a
                              second sheet. */}
                          {item.options && Object.keys(item.options).length > 0 && (
                            <p className="text-[0.625rem] text-gray-600 font-medium leading-snug">
                              {Object.entries(item.options)
                                .map(([k, v]) => `${k}: ${typeof v === 'object' && v !== null ? (v as any).label : String(v)}`)
                                .join(' · ')}
                            </p>
                          )}

                          <LineChargesNote item={item} currency="kr" t={t} />
                        </td>
                        <td className="px-3 py-2 text-center font-bold text-gray-900 text-sm">{item.quantity}</td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-gray-700 whitespace-nowrap">{itemUnitPriceExVat} kr</td>
                        <td className="px-3 py-2 text-right font-mono font-black text-gray-900 text-sm whitespace-nowrap">{itemLineTotalExVat} kr</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Calculations & Totals Summary */}
            <div className="flex flex-col @lg:flex-row justify-between items-start gap-6 pt-2">
              {/* Notes & F-Skatt legal */}
              <div className="max-w-md space-y-3 text-xs text-gray-500">
                <div className="p-3.5 bg-amber-50/80 border border-amber-200/80 rounded-2xl text-amber-900 space-y-1">
                  <p className="font-bold flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>{t('docLegalFTaxCompliance')}</span>
                  </p>
                  <p className="text-[0.6875rem] leading-relaxed">
                    {t('docFTaxLine1')}{' '}
                    {sellerName}{' '}{t('docFTaxLine2')}
                  </p>
                </div>
              </div>

              {/* Totals Box */}
              <div className="w-full @lg:w-80 bg-gray-50 p-5 rounded-2xl border border-gray-200/90 space-y-2.5 text-xs font-semibold text-gray-700">
                <div className="flex justify-between items-center pb-1">
                  <span>{t('docGoodsExclVat')}</span>
                  <span className="font-mono font-bold text-gray-900">{goodsBeforeDiscounts.toFixed(2)} {currency}</span>
                </div>

                {couponDiscount > 0 && (
                  <div className="flex justify-between items-center pb-1 text-emerald-700 font-bold">
                    <span>{t('docCouponDiscount')}</span>
                    <span className="font-mono">-{couponDiscount.toFixed(2)} {currency}</span>
                  </div>
                )}

                {pointsDiscount > 0 && (
                  <div className="flex justify-between items-center pb-1 text-emerald-700 font-bold">
                    <span>{t('docLoyaltyDiscount')}</span>
                    <span className="font-mono">-{pointsDiscount.toFixed(2)} {currency}</span>
                  </div>
                )}

                {shippingCost > 0 && (
                  <div className="flex justify-between items-center pb-1">
                    <span>{t('docShippingExclVat')}</span>
                    <span className="font-mono font-bold text-gray-900">{shippingCost.toFixed(2)} {currency}</span>
                  </div>
                )}

                <div className="flex justify-between items-center pb-1 border-t border-gray-200 pt-2">
                  <span>{t('docNetTotalExclVat')}</span>
                  <span className="font-mono font-bold text-gray-900">{netAmount.toFixed(2)} {currency}</span>
                </div>

                <div className="flex justify-between items-center pb-1">
                  <span>
                    {t('docVatLabel')} ({Math.round(vatRate * 100)}%):
                  </span>
                  <span className="font-mono font-bold text-gray-900">{vatAmount.toFixed(2)} {currency}</span>
                </div>

                <div className="border-t border-gray-300 pt-3 flex justify-between items-center text-base font-black text-gray-900">
                  <span className="uppercase">{t('docTotalInclVat')}</span>
                  <span className="font-mono text-orange-600 text-lg">
                    {formatCurrency(totalAmount, currency)}
                  </span>
                </div>

                {/* CREDITED BACK. A partial refund deliberately leaves the order
                    at `paid`, so without this the invoice shows the full amount
                    as owed and paid with no trace that some of it was returned. */}
                {(refundedTotal > 0 || creditNoteNumbers.length > 0) && (
                  <div className="pt-2 mt-2 border-t border-gray-200 space-y-1">
                    <div className="flex justify-between text-xs font-black text-gray-700">
                      <span>{t('docCreditedBack')}</span>
                      <span>−{formatCurrency(refundedTotal, currency)}</span>
                    </div>
                    {creditNoteNumbers.length > 0 && (
                      <p className="text-[0.625rem] text-gray-500 font-bold">
                        {t('docCreditNoteRef')} {creditNoteNumbers.join(', ')}
                      </p>
                    )}
                    <div className="flex justify-between text-xs font-black text-gray-900">
                      <span>{t('docNetPaid')}</span>
                      <span>{formatCurrency(Math.max(0, totalAmount - refundedTotal), currency)}</span>
                    </div>
                  </div>
                )}

                {/* The real payment state. This used to read "PAID IN FULL" on
                    every invoice, including orders where nothing had been paid. */}
                {isPaid ? (
                  <div className="pt-2 text-[0.625rem] text-emerald-700 font-black uppercase text-center bg-emerald-50 py-1.5 rounded-xl border border-emerald-200">
                    ✓ {t('docPaidInFull')}
                  </div>
                ) : isRefunded ? (
                  <div className="pt-2 text-[0.625rem] text-gray-700 font-black uppercase text-center bg-gray-100 py-1.5 rounded-xl border border-gray-300">
                    {t('docRefunded')}
                  </div>
                ) : (
                  <div className="pt-2 text-[0.625rem] text-amber-800 font-black uppercase text-center bg-amber-50 py-1.5 rounded-xl border border-amber-300">
                    {onDelivery ? t('docToPayOnDelivery') : t('docAwaitingPayment')}
                  </div>
                )}
              </div>
            </div>

            {/* The sentence a reverse-charge or export invoice must carry. */}
            {vatNote && (
              <div className="border border-gray-300 rounded-2xl px-4 py-3 text-[0.6875rem] font-bold text-gray-700 bg-gray-50">
                {vatNote}
                {order.buyerVatNumber && (
                  <span className="block text-gray-500 font-medium mt-1">
                    {t('docBuyerVatNumber')} {order.buyerVatNumber}
                  </span>
                )}
              </div>
            )}

            {/* Official Stamp Footer */}
            <div className="border-t border-gray-200 pt-3 flex flex-col @lg:flex-row justify-between items-center text-[0.6875rem] text-gray-400 font-medium gap-4">
              <p>© {invoiceYear} {sellerName} • {t('footerRightsReserved')}</p>
              <div className="flex items-center space-x-2 space-x-reverse font-bold text-gray-600">
                <span>{t('docInvoiceNoLabel')} {invoiceNumber}</span>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
