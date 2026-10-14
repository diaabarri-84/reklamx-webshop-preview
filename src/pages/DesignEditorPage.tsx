import React, { useCallback, useEffect, useState } from 'react';
import { writeCart } from '../lib/cart';
import { Link } from 'react-router-dom';
import { collection, doc, getDocs, query, where, setDoc, deleteDoc } from 'firebase/firestore';
import { AlertTriangle, CheckCircle2, FolderOpen, Trash2, ShoppingCart, Lock } from 'lucide-react';
import { db, auth } from '../firebase';
import { useConfirmDialog } from '../components/ConfirmDialog';
import { useAuth } from '../App';
import CanvasEditor from '../components/Editor/CanvasEditor';
import SafeImage from '../components/SafeImage';
import { calcLinearMeterPrice } from '../lib/pricing';
import { artworkWouldOverflow } from '../lib/artworkLimits';

/**
 * The online design editor, with somewhere for the design to go.
 *
 * The editor itself worked; its Save button did `console.log('Saved:', data)`.
 * A customer could spend an hour on a design and lose all of it by navigating
 * away, while the home page advertised the feature.
 *
 * Two things are stored per design: the fabric JSON, which is what reopens it for
 * editing, and a PNG at 2x, which is what the shop actually prints. Saving only
 * the JSON would leave production with a file it cannot use.
 */

type SavedDesign = {
  id: string;
  name: string;
  json: string;
  previewPng: string;
  updatedAt: string;
};

// A design document holds the fabric JSON and a PNG preview, and Firestore
// rejects any document over 1 MiB.
const MAX_DESIGN_BYTES = 900 * 1024;

// The printed size of a design ordered from the editor. The canvas is 800x600,
// so this keeps the proportions roughly right on a standard roll width.
const DESIGN_WIDTH_CM = 28;
const DESIGN_HEIGHT_CM = 35;

export default function DesignEditorPage() {
  const { user, openAuthModal, t } = useAuth();
  // In-page dialogs, never window.confirm/alert — a browser that has been told
  // to stop prompting silences those, and the action then does nothing at all.
  const { confirm, notify, dialog: confirmDialog } = useConfirmDialog();

  const [designs, setDesigns] = useState<SavedDesign[]>([]);
  const [current, setCurrent] = useState<SavedDesign | null>(null);
  const [name, setName] = useState(t('edDefaultDesignName'));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const loadDesigns = useCallback(async () => {
    if (!user) {
      setDesigns([]);
      return;
    }
    try {
      const snap = await getDocs(query(collection(db, 'designs'), where('userId', '==', user.uid)));
      const list = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<SavedDesign, 'id'>) }))
        .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
      setDesigns(list);
    } catch (err) {
      console.error('Could not load saved designs:', err);
    }
  }, [user]);

  useEffect(() => {
    loadDesigns();
  }, [loadDesigns]);

  const handleSave = async (json: string, previewPng: string) => {
    if (!user) {
      // Nothing is lost: the canvas keeps the work while they sign in.
      setMessage({ kind: 'error', text: t('edSignInToSave') });
      openAuthModal?.();
      return;
    }

    const size = json.length + previewPng.length;
    if (size > MAX_DESIGN_BYTES) {
      setMessage({
        kind: 'error',
        text: t('edTooLarge').replace('{0}', (size / 1024 / 1024).toFixed(1)),
      });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const id = current?.id ?? `dsg-${user.uid.slice(0, 6)}-${Date.now()}`;
      const record: SavedDesign & { userId: string } = {
        id,
        userId: user.uid,
        name: name.trim() || t('edUntitledDesign'),
        json,
        previewPng,
        updatedAt: new Date().toISOString(),
      };
      await setDoc(doc(db, 'designs', id), record, { merge: true });
      setCurrent(record);
      setMessage({ kind: 'ok', text: t('edSaved') });
      await loadDesigns();
    } catch (err: any) {
      console.error('Saving the design failed:', err);
      setMessage({ kind: 'error', text: t('edSaveFailed') });
    } finally {
      setSaving(false);
    }
  };

  const handleOpen = (d: SavedDesign) => {
    setCurrent(d);
    setName(d.name);
    setMessage(null);
  };

  const handleDelete = async (d: SavedDesign) => {
    const ok = await confirm({
      title: t('edDeleteConfirmTitle').replace('{0}', d.name),
      message: t('caDeleteCannotUndo'),
      confirmLabel: t('umConfirmDelete'),
    });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, 'designs', d.id));
      if (current?.id === d.id) setCurrent(null);
      await loadDesigns();
    } catch (err) {
      console.error('Deleting the design failed:', err);
      setMessage({ kind: 'error', text: t('edDeleteFailed') });
    }
  };

  /** Put the finished design into the basket as the artwork for a print job. */
  const handleAddToCart = (d: SavedDesign) => {
    try {
      const cart = JSON.parse(localStorage.getItem('reklamx_cart') || '[]');

      // The design's PNG counts against the same artwork budget as an uploaded
      // file, and the server sums it across the whole cart.
      const overflow = artworkWouldOverflow(cart, Math.ceil((d.previewPng?.length ?? 0) * 0.75));
      if (overflow) {
        setMessage({ kind: 'error', text: overflow });
        return;
      }

      // The server prices this the same way it prices any custom upload. The
      // preview shown in the basket is calculated here with the SAME function, so
      // the two agree. It used to be omitted entirely: the basket counted the
      // design as 0 kr, and the customer only learned the real figure at the
      // payment page.
      const { unitPrice, totalPrice } = calcLinearMeterPrice({ heightCm: DESIGN_HEIGHT_CM, quantity: 1 });

      cart.push({
        id: `design-${d.id}-${Date.now()}`,
        isCustomUpload: true,
        productName: t('edCartItemPrefix') + ' ' + d.name,
        title: d.name,
        quantity: 1,
        widthCm: DESIGN_WIDTH_CM,
        heightCm: DESIGN_HEIGHT_CM,
        unitPrice,
        totalPrice,
        fileName: `${d.name}.png`,
        fileUrl: d.previewPng,
        fileSpecs: {
          fileName: `${d.name}.png`,
          fileUrl: d.previewPng,
          widthCm: DESIGN_WIDTH_CM,
          heightCm: DESIGN_HEIGHT_CM,
          fileType: 'PNG',
        },
      });
      writeCart(cart);
      window.dispatchEvent(new Event('storage'));
      setMessage({ kind: 'ok', text: t('cfgAddedToCart') });
    } catch {
      setMessage({ kind: 'error', text: t('shopCartSaveError') });
    }
  };

  return (
    <div className="max-w-[87.5rem] mx-auto px-4 sm:px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-5">
        <div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight">{t('edPageTitle')}</h1>
          <p className="text-sm text-gray-500">{t('edPageSubtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('edNamePlaceholder')}
            className="px-4 py-2.5 bg-white border border-gray-200 rounded-2xl text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
          />
          {current && (
            <button
              onClick={() => handleAddToCart(current)}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-gray-900 text-white text-sm font-black rounded-2xl hover:bg-orange-600 transition-colors"
            >
              <ShoppingCart className="w-4 h-4" />
              {t('edOrderThisDesign')}
            </button>
          )}
        </div>
      </div>

      {!user && (
        <div className="mb-4 flex items-start gap-2.5 bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3">
          <Lock className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" />
          <p className="text-[0.8125rem] text-gray-600 font-medium">
            {t('edGuestNotice')}
          </p>
        </div>
      )}

      {message && (
        <div
          role="alert"
          className={`mb-4 flex items-start gap-2.5 rounded-2xl px-4 py-3 border ${
            message.kind === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-amber-50 border-amber-300 text-amber-900'
          }`}
        >
          {message.kind === 'ok' ? (
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          )}
          <p className="text-xs font-bold leading-relaxed">{message.text}</p>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_17.5rem] gap-5">
        <div className="h-[40rem]">
          <CanvasEditor key={current?.id ?? 'blank'} initialData={current?.json} onSave={handleSave} saving={saving} />
        </div>

        <aside className="bg-white rounded-2xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-3">
            <FolderOpen className="w-4 h-4 text-gray-500" />
            <h2 className="text-sm font-black text-gray-900">{t('edSavedDesignsHeading')}</h2>
          </div>

          {!user ? (
            <p className="text-xs text-gray-500 leading-relaxed">{t('edSignInToKeep')}</p>
          ) : designs.length === 0 ? (
            <p className="text-xs text-gray-500 leading-relaxed">{t('edEmpty')}</p>
          ) : (
            <ul className="space-y-2">
              {designs.map((d) => (
                <li
                  key={d.id}
                  className={`border rounded-2xl p-2.5 transition-colors ${
                    current?.id === d.id ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <button onClick={() => handleOpen(d)} className="w-full text-left">
                    {d.previewPng && (
                      <SafeImage
                        src={d.previewPng}
                        alt={d.name}
                        className="w-full h-24 object-contain bg-gray-50 rounded-xl border border-gray-100 mb-2"
                      />
                    )}
                    <span className="block text-xs font-black text-gray-900 truncate">{d.name}</span>
                    <span className="block text-[0.625rem] text-gray-400">
                      {new Date(d.updatedAt).toLocaleDateString('sv-SE')}
                    </span>
                  </button>
                  <div className="flex gap-1.5 mt-2">
                    <button
                      onClick={() => handleAddToCart(d)}
                      className="flex-1 text-[0.625rem] font-black py-1.5 bg-gray-900 text-white rounded-lg hover:bg-orange-600 transition-colors"
                    >
                      {t('edOrderButton')}
                    </button>
                    <button
                      onClick={() => handleDelete(d)}
                      aria-label={t('edDeleteDesignAria').replace('{0}', d.name)}
                      className="px-2 py-1.5 text-gray-400 hover:text-red-600 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <p className="text-[0.625rem] text-gray-400 mt-4 leading-relaxed">
            {t('edPreferFinishedFile')}{' '}
            <Link to="/custom-upload" className="underline underline-offset-2 font-bold text-gray-600">
              {t('edUploadItHere')}
            </Link>
            .
          </p>
        </aside>
      </div>
      {confirmDialog}
    </div>
  );
}
