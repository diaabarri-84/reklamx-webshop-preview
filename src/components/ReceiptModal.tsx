import React, { useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, 
  Printer, 
  CheckCircle2, 
  CreditCard, 
  Receipt, 
  Calendar, 
  Building2,
  Download,
  Lock,
  Sparkles
} from 'lucide-react';
import { Order } from '../types';
import { formatCurrency } from '../lib/utils';
import { useSiteSettings } from '../context/SiteSettingsContext';
import { useAuth } from '../App';
import LineChargesNote from './LineChargesNote';
import { orderMoney } from '../lib/orderMoney';
import { paymentTitleOf } from '../lib/orderQueue';

interface ReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: Order | null;
}

export default function ReceiptModal({ isOpen, onClose, order}: ReceiptModalProps) {
  const printRef = useRef<HTMLDivElement>(null);
  const { settings } = useSiteSettings();
  const { t } = useAuth();

  if (!isOpen || !order) return null;

  const receiptYear = new Date(order.createdAt).getFullYear() || new Date().getFullYear();
  const receiptNumber = `REC-${receiptYear}-${order.id.replace(/^ORD-/, '').replace(/^ORD/, '')}`;
  const paymentDate = new Date(order.createdAt).toLocaleString('sv-SE', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  // The provider's own payment reference, or nothing.
  //
  // This used to be MANUFACTURED: the order id's character codes summed and
  // multiplied by 8849, printed beside the words "SSL Encrypted Payment Auth Ref".
  // It looked like a bank authorisation and referred to nothing. If the payment
  // provider gave us a reference we print that; otherwise the line is omitted.
  const transactionRef: string | null = order.molliePaymentId ?? null;

  // Same rule as the invoice — the same function: read the stored breakdown,
  // do not re-derive VAT from a total whose convention is unknown.
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

  // A receipt is proof of payment, so it must not claim one that never happened.
  const isPaid = order.paymentStatus === 'paid';
  const sellerName = settings.companyLegalName?.trim() || settings.siteName || 'ReklamX';
  const sellerOrgNr = settings.orgNumber?.trim() || t('docNotSet');

  const handlePrint = () => {
    window.print();
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/70 backdrop-blur-md overflow-y-auto print:p-0 print:bg-white print:static print:inset-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="bg-white rounded-3xl max-w-2xl w-full max-h-[92vh] overflow-y-auto shadow-2xl border border-gray-200 print:shadow-none print:border-none print:max-h-none print:rounded-none text-gray-900"
          dir={'ltr'}
        >
          {/* Top Bar (Hidden on Print) */}
          <div className="bg-emerald-950 text-white p-4 sm:px-6 sm:py-4 flex items-center justify-between sticky top-0 z-20 print:hidden border-b border-emerald-800/80">
            <div className="flex items-center space-x-3 space-x-reverse">
              <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-black shadow-md">
                <Receipt className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-extrabold text-base flex items-center space-x-2 space-x-reverse">
                  <span>{t('docReceiptTitle')}</span>
                  <span className="bg-emerald-500/30 text-emerald-300 text-[0.625rem] font-black px-2 py-0.5 rounded-full uppercase border border-emerald-400/30">
                    {isPaid ? t('rcptBadgePaid') : t('rcptBadgeUnpaid')}
                  </span>
                </h3>
                <p className="text-xs text-emerald-200/80 font-mono">
                  #{receiptNumber}{transactionRef ? ` • ${t('rcptRefLabel')} ${transactionRef}` : ''}
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-2 space-x-reverse">
              <button
                onClick={handlePrint}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-black px-4 py-2 rounded-xl text-xs flex items-center space-x-1.5 space-x-reverse transition-all shadow-md active:scale-95 cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>{t('docPrintReceipt')}</span>
              </button>

              <button
                onClick={onClose}
                className="p-2 text-emerald-300 hover:text-white hover:bg-emerald-900 rounded-xl transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* PRINTABLE RECEIPT CONTENT */}
          <div ref={printRef} className="rx-print-sheet p-6 sm:p-8 space-y-6 bg-white" id="printable-receipt">
            {/* Header / Banner */}
            <div className="text-center space-y-2 border-b border-gray-200 pb-6">
              <div className="w-12 h-12 bg-emerald-100 text-emerald-700 rounded-2xl flex items-center justify-center mx-auto shadow-sm">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <h2 className="text-2xl font-black text-gray-900 tracking-tight">
                {t('docReceiptHeading')}
              </h2>
              <p className="text-xs text-gray-500 font-medium">
                {isPaid
                  ? (t('docReceiptThanksPaid').replace('{0}', sellerName))
                  : (t('docReceiptNotPaidYet'))}
              </p>
            </div>

            {/* Receipt Summary Grid */}
            <div className="grid grid-cols-2 @lg:grid-cols-4 gap-3 bg-gray-50 p-4 rounded-2xl border border-gray-200/80 text-xs">
              <div>
                <span className="text-gray-400 font-bold uppercase block text-[0.625rem]">{t('docReceiptNo')}</span>
                <span className="font-mono font-extrabold text-gray-900">{receiptNumber}</span>
              </div>

              <div>
                <span className="text-gray-400 font-bold uppercase block text-[0.625rem]">{t('docOrderId')}</span>
                <span className="font-mono font-extrabold text-gray-900">#{order.id}</span>
              </div>

              <div>
                <span className="text-gray-400 font-bold uppercase block text-[0.625rem]">{t('docPaymentDate')}</span>
                <span className="font-bold text-gray-900">{paymentDate}</span>
              </div>

              <div>
                <span className="text-gray-400 font-bold uppercase block text-[0.625rem]">{t('docPaymentMethodShort')}</span>
                <span className="font-extrabold text-emerald-700 uppercase">
                  {paymentTitleOf(order, t) || t('rcptPaymentMethodFallback')}
                </span>
              </div>
            </div>

            {/* Payer Info */}
            <div className="bg-emerald-50/60 p-4 rounded-2xl border border-emerald-200/80 space-y-1 text-xs">
              <span className="text-emerald-900 font-black uppercase tracking-wider text-[0.625rem] block">
                {t('docPayerInformation')}
              </span>
              <p className="font-extrabold text-gray-900 text-sm">{order.customerName}</p>
              <p className="text-gray-600 font-mono">{order.customerEmail}</p>
              {/* Checkout writes `company`; `companyName` is the older spelling.
                  Reading only the old one left every business buyer's company
                  off the receipt — the invoice had the same bug. */}
              {(order.customerDetails?.company || order.customerDetails?.companyName) && (
                <p className="text-purple-900 font-bold">
                  {t('checkoutShipCompany')}: {order.customerDetails?.company || order.customerDetails?.companyName}
                </p>
              )}
            </div>

            {/* Itemized Purchased Products */}
            <div className="border border-gray-200 rounded-2xl overflow-hidden">
              <table className="w-full text-left text-xs" dir={'ltr'}>
                <thead>
                  <tr className="bg-gray-100 text-gray-700 font-bold uppercase text-[0.625rem] border-b border-gray-200">
                    <th className="px-3 py-2">{t('docColItemDescription')}</th>
                    <th className="px-3 py-2 text-center">{t('docReceiptColQty')}</th>
                    <th className="px-3 py-2 text-right">{t('docColAmount')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 font-semibold text-gray-800">
                  {(order.items ?? []).map((item, idx) => (
                    <tr key={idx} className="align-top">
                      <td className="px-3 py-1.5">
                        <span className="font-bold text-gray-900 block">{item.productName}</span>
                        {item.fileSpecs && (
                          <span className="text-[0.625rem] text-gray-500 block">
                            {item.fileSpecs.widthCm && item.fileSpecs.heightCm
                              ? `${item.fileSpecs.widthCm}×${item.fileSpecs.heightCm} cm • `
                              : ''}
                            {item.fileSpecs.fileName}
                          </span>
                        )}
                        <LineChargesNote item={item} currency={currency} t={t} />
                      </td>
                      <td className="px-3 py-1.5 text-center font-bold">{item.quantity}</td>
                      <td className="px-3 py-1.5 text-right font-mono font-bold text-gray-900 whitespace-nowrap">{(Number(item.price) || 0).toFixed(2)} {currency}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Financial Breakdown Box */}
            <div className="bg-gray-50 p-4 rounded-2xl border border-gray-200 space-y-2 text-xs font-medium text-gray-700">
              <div className="flex justify-between items-center">
                <span>{t('docReceiptGoodsExclVat')}</span>
                <span className="font-mono font-bold">{goodsBeforeDiscounts.toFixed(2)} {currency}</span>
              </div>

              {couponDiscount > 0 && (
                <div className="flex justify-between items-center text-emerald-700 font-bold">
                  <span>{t('docCouponDiscount')}</span>
                  <span className="font-mono">-{couponDiscount.toFixed(2)} {currency}</span>
                </div>
              )}

              {pointsDiscount > 0 && (
                <div className="flex justify-between items-center text-emerald-700 font-bold">
                  <span>{t('docLoyaltyPointsDiscount')}</span>
                  <span className="font-mono">-{pointsDiscount.toFixed(2)} {currency}</span>
                </div>
              )}

              {shippingCost > 0 && (
                <div className="flex justify-between items-center">
                  <span>{t('docReceiptShippingExclVat')}</span>
                  <span className="font-mono font-bold">{shippingCost.toFixed(2)} {currency}</span>
                </div>
              )}

              <div className="flex justify-between items-center border-t border-gray-200 pt-2">
                <span>{t('docReceiptNetTotalExclVat')}</span>
                <span className="font-mono font-bold">{netAmount.toFixed(2)} {currency}</span>
              </div>

              <div className="flex justify-between items-center">
                <span>{t('docVatLabel')} ({Math.round(vatRate * 100)}%):</span>
                <span className="font-mono font-bold">{vatAmount.toFixed(2)} {currency}</span>
              </div>

              <div className="border-t border-gray-300 pt-2.5 flex justify-between items-center text-sm font-black text-gray-900">
                <span className="uppercase">
                  {isPaid
                    ? (t('docTotalAmountPaid'))
                    : (t('docTotalAmountDue'))}
                </span>
                <span className={`font-mono text-base ${isPaid ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {formatCurrency(totalAmount, currency)}
                </span>
              </div>
            </div>

            {/* Security Verification Footer */}
            <div className="pt-4 border-t border-gray-200 flex flex-col @lg:flex-row justify-between items-center text-[0.625rem] text-gray-400 font-medium gap-3">
              <div className="flex items-center space-x-2 space-x-reverse text-gray-600 font-bold">
                <Lock className="w-3.5 h-3.5 text-emerald-600" />
                <span>{transactionRef ? `${t('rcptPaymentRefLabel')} ${transactionRef}` : t('rcptNoPaymentRef')}</span>
              </div>
              <p>{sellerName} • {t('rcptOrgNrLabel')} {sellerOrgNr}</p>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
