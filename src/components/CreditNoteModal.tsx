// KREDITNOTA — the document, on its own.
//
// He confirmed on 2026-09-12 that he issues one when he refunds, not just the
// money. Under Swedish rules an issued invoice cannot be edited or deleted, so
// this is a SEPARATE document that references the invoice and carries the
// amounts back out again. It is not a note on the invoice and it cannot be one:
// it has its own number, its own date, and it has to stand alone in the books.
//
// It uses `rx-print-sheet`, the same class the invoice, the receipt, the work
// order and the packing slip use. That is not cosmetic — print CSS in
// src/index.css hides everything that neither contains nor belongs to that class
// and strips the ancestor chain, which is what fixed the bug where the printed
// sheet began on page five.

import { useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Printer, FileMinus, Building2, Calendar } from 'lucide-react';
import { formatCurrency } from '../lib/utils';
import { useSiteSettings } from '../context/SiteSettingsContext';
import { useAuth } from '../App';

/** Exactly what the server writes to creditNotes/<number>. */
export interface CreditNoteDoc {
  creditNoteNumber: string;
  orderId: string;
  orderNumber?: string;
  issuedAt: string;
  reason?: string;
  gross: number;
  net: number;
  vat: number;
  vatShare?: number;
  currency?: string;
  vatRate?: number;
  vatRegime?: string | null;
  vatInvoiceNote?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerDetails?: Record<string, any> | null;
  buyerVatNumber?: string | null;
  refundedBefore?: number;
  refundedAfter?: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  note: CreditNoteDoc | null;
}

export default function CreditNoteModal({ isOpen, onClose, note }: Props) {
  const printRef = useRef<HTMLDivElement>(null);
  const { settings } = useSiteSettings();
  const { t } = useAuth();

  if (!isOpen || !note) return null;

  const currency = note.currency || 'SEK';
  const issued = new Date(note.issuedAt);
  const issuedDate = Number.isFinite(issued.getTime())
    ? issued.toLocaleDateString('sv-SE', { year: 'numeric', month: 'long', day: 'numeric' })
    : '—';

  const MISSING = t('docNotSet');
  const sellerName = settings.companyLegalName?.trim() || settings.siteName || 'ReklamX';
  const sellerAddress = settings.companyAddress?.trim() || MISSING;
  const sellerEmail = settings.contactEmail?.trim() || MISSING;
  // Org.nr and VAT are legally required on this document just as they are on an
  // invoice, so a gap is printed LOUDLY rather than hidden.
  const sellerOrgNr = settings.orgNumber?.trim() || MISSING;
  const sellerVatNr = settings.vatNumber?.trim() || MISSING;

  const buyer = note.customerDetails ?? {};
  const buyerCompany = buyer.company || buyer.companyName || '';
  const buyerLines = [
    buyer.address1, buyer.address2,
    [buyer.postcode, buyer.city].filter(Boolean).join(' '),
    buyer.country,
  ].filter(Boolean) as string[];

  // The VAT actually credited, as a percentage, from the document's own figures.
  // Not from today's rate, and not from a constant: this may be a 6% order, or a
  // reverse-charge one carrying no VAT at all.
  const effectiveVatPercent = note.net > 0 ? Math.round((note.vat / note.net) * 100) : 0;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/70 backdrop-blur-md overflow-y-auto print:p-0 print:bg-white print:static print:inset-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="bg-white rounded-3xl max-w-3xl w-full max-h-[92vh] overflow-y-auto shadow-2xl border border-gray-200 print:shadow-none print:border-none print:max-h-none print:rounded-none text-gray-900"
          dir="ltr"
        >
          <div className="bg-gray-900 text-white p-4 sm:px-8 sm:py-5 flex items-center justify-between sticky top-0 z-20 print:hidden border-b border-gray-800">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gray-700 text-white flex items-center justify-center">
                <FileMinus className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-extrabold text-base">{t('cnTitle')}</h3>
                <p className="text-[0.6875rem] text-gray-400 font-bold">{note.creditNoteNumber}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="px-4 py-2 bg-white text-gray-900 text-xs font-black rounded-xl hover:bg-gray-100 inline-flex items-center gap-1.5"
              >
                <Printer className="w-4 h-4" />
                {t('docPrintSavePdf')}
              </button>
              <button type="button" onClick={onClose} className="p-2 rounded-xl hover:bg-white/10" aria-label={t('mlCancel')}>
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div ref={printRef} className="rx-print-sheet p-6 sm:p-10 space-y-8 bg-white">
            <div className="flex flex-col @lg:flex-row justify-between gap-6 border-b border-gray-200 pb-6">
              <div>
                <h1 className="text-2xl font-black tracking-tight">{t('cnTitle')}</h1>
                <p className="text-xs font-bold text-gray-500 mt-1">{note.creditNoteNumber}</p>
                {/* A credit note that does not name the invoice it credits is not
                    a credit note — it is an unexplained negative amount. */}
                <p className="text-xs font-bold text-gray-700 mt-3">
                  {t('cnRefersTo')} <span className="font-black">{note.orderNumber || note.orderId}</span>
                </p>
                <p className="text-xs text-gray-500 font-medium mt-1 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" />
                  {t('cnIssued')} {issuedDate}
                </p>
              </div>
              <div className="text-xs text-gray-600 @lg:text-right space-y-0.5">
                <p className="font-black text-gray-900 flex items-center gap-1.5 @lg:justify-end">
                  <Building2 className="w-3.5 h-3.5" />{sellerName}
                </p>
                <p>{sellerAddress}</p>
                <p>{sellerEmail}</p>
                <p>{t('docOrgNrLabel')} {sellerOrgNr}</p>
                <p>{t('docVatNrLabel')} {sellerVatNr}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 @lg:grid-cols-2 gap-6 text-xs">
              <div>
                <p className="font-black text-gray-900 mb-1">{t('cnCreditedTo')}</p>
                {buyerCompany && <p className="font-bold">{buyerCompany}</p>}
                <p>{note.customerName || '—'}</p>
                {buyerLines.map((line, i) => <p key={i}>{line}</p>)}
                {note.customerEmail && <p className="text-gray-500">{note.customerEmail}</p>}
                {note.buyerVatNumber && (
                  <p className="text-gray-500 mt-1">{t('docBuyerVatNumber')} {note.buyerVatNumber}</p>
                )}
              </div>
              <div>
                <p className="font-black text-gray-900 mb-1">{t('cnReason')}</p>
                <p className="text-gray-700">{note.reason || '—'}</p>
              </div>
            </div>

            {/* NEGATIVE, and shown as such. The figures are stored positive so no
                future sum has to remember a sign; the document is where they
                become a credit. */}
            <div className="border border-gray-200 rounded-2xl overflow-hidden">
              <table className="w-full text-xs" dir="ltr">
                <tbody className="divide-y divide-gray-100">
                  <tr>
                    <td className="px-4 py-3 font-bold text-gray-600">{t('cnNetLabel')}</td>
                    <td className="px-4 py-3 text-right font-black">−{formatCurrency(note.net, currency)}</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-bold text-gray-600">
                      {t('cnVatLabel')}{note.net > 0 ? ` (${effectiveVatPercent}%)` : ''}
                    </td>
                    <td className="px-4 py-3 text-right font-black">−{formatCurrency(note.vat, currency)}</td>
                  </tr>
                  <tr className="bg-gray-50">
                    <td className="px-4 py-4 font-black text-gray-900 text-sm">{t('cnTotalLabel')}</td>
                    <td className="px-4 py-4 text-right font-black text-gray-900 text-sm">
                      −{formatCurrency(note.gross, currency)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Carried from the order. A credit note against a reverse-charge
                invoice must repeat the statement, or it reads as a refund of VAT
                that was never charged. */}
            {note.vatInvoiceNote && (
              <div className="border border-gray-300 rounded-2xl px-4 py-3 text-[0.6875rem] font-bold text-gray-700 bg-gray-50">
                {note.vatInvoiceNote}
              </div>
            )}

            <p className="text-[0.6875rem] text-gray-500 font-medium">{t('cnFooterNote')}</p>

            <div className="border-t border-gray-200 pt-6 flex justify-between items-center text-[0.6875rem] text-gray-400 font-medium">
              <p>© {issued.getFullYear() || new Date().getFullYear()} {sellerName}</p>
              <span className="font-bold text-gray-600">{note.creditNoteNumber}</span>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
