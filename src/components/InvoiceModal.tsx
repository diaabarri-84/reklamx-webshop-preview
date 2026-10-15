import React, { useRef } from 'react';
import { X, Printer } from 'lucide-react';
import { Order } from '../types';
import { formatCurrency } from '../lib/utils';
import { logoSrc } from '../lib/brandLogo';
import { useSiteSettings } from '../context/SiteSettingsContext';
import { useAuth } from '../App';
import LineChargesNote from './LineChargesNote';
import { isOnDeliveryOpen, paymentTitleOf } from '../lib/orderQueue';
import { orderMoney } from '../lib/orderMoney';

interface InvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: Order | null;
}

export default function InvoiceModal({ isOpen, onClose, order}: InvoiceModalProps) {
  const printRef = useRef<HTMLDivElement>(null);
  const { settings } = useSiteSettings();
  const { t, language } = useAuth();

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


  /**
   * A PLAIN INVOICE (2026-10-15, the owner's request: "regular boring invoice
   * templates"). Black on white, thin rules, no badges, icons or coloured
   * boxes — the layout of an ordinary Swedish faktura: seller's logo and the
   * word FAKTURA, buyer on the left and invoice details on the right, the
   * lines, the totals, and the seller's company details in the footer.
   */
  const bare = (s: string) => s.replace(/:\s*$/, '');
  const L = ({
    sv: { title: 'Faktura', phone: 'Telefon', email: 'E-post', fTax: 'Godkänd för F-skatt', status: 'Betalstatus' },
    en: { title: 'Invoice', phone: 'Phone', email: 'Email', fTax: 'Approved for F-tax', status: 'Payment status' },
    da: { title: 'Faktura', phone: 'Telefon', email: 'E-mail', fTax: 'Godkendt for F-skat (SE)', status: 'Betalingsstatus' },
    no: { title: 'Faktura', phone: 'Telefon', email: 'E-post', fTax: 'Godkjent for F-skatt (SE)', status: 'Betalingsstatus' },
  } as Record<string, { title: string; phone: string; email: string; fTax: string; status: string }>)[language] ?? {
    title: 'Invoice', phone: 'Phone', email: 'Email', fTax: 'Approved for F-tax', status: 'Payment status',
  };
  const statusText = bare(
    (isPaid ? t('docPaymentStatusPaidInFull')
      : isRefunded ? t('docPaymentStatusRefunded')
      : onDelivery ? t('docPaymentStatusOnDelivery')
      : t('docPaymentStatusAwaiting')).replace(/^[^:]*:\s*/, ''),
  );
  const buyerAddress = [
    order.customerDetails?.address1 || '',
    [order.customerDetails?.postcode, order.customerDetails?.city].filter(Boolean).join(' '),
    order.customerDetails?.country || '',
  ].filter(Boolean);

  const meta: [string, React.ReactNode][] = [
    [bare(t('docInvoiceNoLabel')), invoiceNumber],
    [bare(t('docInvoiceDate')), orderDate],
    [bare(t('docOrderId')), order.id],
    [bare(t('docPaymentMethod')), paymentTitleOf(order, t) || '—'],
    [bare(t('docDeliveryMethod')), order.shippingMethodTitle || t('docShippingMethodFallback')],
    ...(completionDate ? [[bare(t('docEstimatedDelivery')), completionDate] as [string, React.ReactNode]] : []),
    [L.status, statusText],
  ];

  const money = (n: number) => `${n.toFixed(2)} ${currency}`;

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-3 sm:p-6 bg-black/60 overflow-y-auto print:p-0 print:bg-white print:static print:inset-auto">
      <div className="bg-white max-w-4xl w-full max-h-[92vh] overflow-y-auto rounded-lg shadow-xl print:shadow-none print:max-h-none print:rounded-none text-gray-900" dir="ltr">
        {/* Toolbar — screen only. */}
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 sm:px-8 py-3 sticky top-0 bg-white z-10 print:hidden">
          <p className="text-sm font-semibold text-gray-900">
            {L.title} <span className="font-normal text-gray-500">{invoiceNumber}</span>
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-2 text-xs font-semibold text-white hover:bg-black cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              {t('docPrintSavePdf')}
            </button>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* THE DOCUMENT */}
        <div ref={printRef} className="rx-print-sheet bg-white px-6 sm:px-12 py-8 sm:py-10 text-[0.8125rem] leading-relaxed" id="printable-invoice">
          {/* Logo and title */}
          <div className="flex items-start justify-between gap-6">
            <img src={logoSrc(settings)} alt={sellerName} loading="eager" className="h-10 w-48 object-contain object-left" />
            <h1 className="text-3xl font-semibold tracking-tight text-gray-900">{L.title}</h1>
          </div>

          {/* Buyer and invoice details */}
          <div className="mt-10 grid grid-cols-2 gap-10">
            <div>
              <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-gray-500">{bare(t('docBilledTo'))}</p>
              <div className="mt-2 text-gray-900">
                {buyerCompany && <p className="font-semibold">{buyerCompany}</p>}
                <p className={buyerCompany ? '' : 'font-semibold'}>{order.customerName}</p>
                {buyerAddress.length ? buyerAddress.map((line, i) => <p key={i}>{line}</p>) : <p>{t('docCustomerAddressFallback')}</p>}
                {buyerTaxId && <p className="mt-2 text-gray-600">{t('docBuyerTaxIdLabel')} {buyerTaxId}</p>}
                <p className="mt-2 text-gray-600">{order.customerEmail}</p>
                {order.customerDetails?.phone && <p className="text-gray-600">{order.customerDetails.phone}</p>}
              </div>
            </div>
            <table className="self-start text-left">
              <tbody>
                {meta.map(([k, v]) => (
                  <tr key={k} className="align-top">
                    <td className="pr-4 py-0.5 text-gray-500 whitespace-nowrap">{k}</td>
                    <td className="py-0.5 text-gray-900">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Lines */}
          <table className="mt-10 w-full text-left">
            <thead>
              <tr className="border-b border-gray-900 text-[0.6875rem] font-semibold uppercase tracking-wide text-gray-600">
                <th className="py-2 pr-3">{t('docColProductSpec')}</th>
                <th className="py-2 px-3 text-right">{t('docColQty')}</th>
                <th className="py-2 px-3 text-right">{t('docColUnitPriceExVat')}</th>
                <th className="py-2 pl-3 text-right">{t('docColLineTotal')}</th>
              </tr>
            </thead>
            <tbody>
              {(order.items ?? []).map((item, index) => {
                // `unitPrice` and `price` are both stored net of VAT, and `price`
                // is already the whole line — see the note in git history.
                const unit = Number(item.unitPrice) || 0;
                const line = Number(item.price) || 0;
                const details = [
                  item.fileSpecs
                    ? [item.fileSpecs.widthCm && item.fileSpecs.heightCm ? `${item.fileSpecs.widthCm}×${item.fileSpecs.heightCm} cm` : '', `${t('docFileLabel')} ${item.fileSpecs.fileName}`].filter(Boolean).join(', ')
                    : '',
                  item.options && Object.keys(item.options).length > 0
                    ? Object.entries(item.options).map(([k, v]) => `${k}: ${typeof v === 'object' && v !== null ? (v as any).label : String(v)}`).join(' · ')
                    : '',
                ].filter(Boolean);
                return (
                  <tr key={index} className="border-b border-gray-200 align-top">
                    <td className="py-2.5 pr-3">
                      <p className="text-gray-900">{item.productName}</p>
                      {details.map((d, i) => <p key={i} className="text-[0.6875rem] text-gray-500">{d}</p>)}
                      <LineChargesNote item={item} currency="kr" t={t} />
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{item.quantity}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap">{unit.toFixed(2)}</td>
                    <td className="py-2.5 pl-3 text-right tabular-nums whitespace-nowrap">{line.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Totals */}
          <div className="mt-6 flex justify-end">
            <table className="w-72 text-left tabular-nums">
              <tbody>
                <tr><td className="py-1 text-gray-600">{bare(t('docGoodsExclVat'))}</td><td className="py-1 text-right">{money(goodsBeforeDiscounts)}</td></tr>
                {couponDiscount > 0 && <tr><td className="py-1 text-gray-600">{bare(t('docCouponDiscount'))}</td><td className="py-1 text-right">−{money(couponDiscount)}</td></tr>}
                {pointsDiscount > 0 && <tr><td className="py-1 text-gray-600">{bare(t('docLoyaltyDiscount'))}</td><td className="py-1 text-right">−{money(pointsDiscount)}</td></tr>}
                {shippingCost > 0 && <tr><td className="py-1 text-gray-600">{bare(t('docShippingExclVat'))}</td><td className="py-1 text-right">{money(shippingCost)}</td></tr>}
                <tr className="border-t border-gray-200"><td className="py-1 text-gray-600">{bare(t('docNetTotalExclVat'))}</td><td className="py-1 text-right">{money(netAmount)}</td></tr>
                <tr><td className="py-1 text-gray-600">{t('docVatLabel')} {Math.round(vatRate * 100)} %</td><td className="py-1 text-right">{money(vatAmount)}</td></tr>
                <tr className="border-t border-gray-900">
                  <td className="pt-2 font-semibold text-gray-900">{bare(t('docTotalInclVat'))}</td>
                  <td className="pt-2 text-right text-base font-semibold text-gray-900 whitespace-nowrap">{formatCurrency(totalAmount, currency)}</td>
                </tr>
                {/* CREDITED BACK. A partial refund leaves the order at `paid`, so
                    without this the invoice shows the full amount with no trace
                    that some of it was returned. */}
                {(refundedTotal > 0 || creditNoteNumbers.length > 0) && (
                  <>
                    <tr><td className="pt-3 text-gray-600">{bare(t('docCreditedBack'))}</td><td className="pt-3 text-right">−{formatCurrency(refundedTotal, currency)}</td></tr>
                    {creditNoteNumbers.length > 0 && (
                      <tr><td colSpan={2} className="text-[0.6875rem] text-gray-500">{t('docCreditNoteRef')} {creditNoteNumbers.join(', ')}</td></tr>
                    )}
                    <tr><td className="py-1 font-semibold">{bare(t('docNetPaid'))}</td><td className="py-1 text-right font-semibold">{formatCurrency(Math.max(0, totalAmount - refundedTotal), currency)}</td></tr>
                  </>
                )}
              </tbody>
            </table>
          </div>

          {/* The sentence a reverse-charge or export invoice must carry. */}
          {vatNote && (
            <p className="mt-8 text-gray-700">
              {vatNote}
              {order.buyerVatNumber && <span className="block text-gray-500">{t('docBuyerVatNumber')} {order.buyerVatNumber}</span>}
            </p>
          )}

          {/* Seller details — where a Swedish invoice keeps them. */}
          <div className="mt-14 border-t border-gray-300 pt-4 grid grid-cols-4 gap-6 text-[0.6875rem] leading-relaxed text-gray-600">
            <div>
              <p className="font-semibold text-gray-900">{sellerName}</p>
              <p>{sellerAddress}</p>
            </div>
            <div>
              <p>{L.phone}: {sellerPhone}</p>
              <p>{L.email}: {sellerEmail}</p>
            </div>
            <div>
              <p>{t('docOrgNrLabel')} {sellerOrgNr}</p>
              <p>{t('docVatNrLabel')} {sellerVatNr}</p>
              <p>{L.fTax}</p>
            </div>
            <div>
              {sellerBankgiro && <p>{t('docBankgiroLabel')} {sellerBankgiro}</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
