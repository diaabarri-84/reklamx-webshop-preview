import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Megaphone,
  Save,
  Tags,
} from 'lucide-react';
import { useSiteSettings } from '../../context/SiteSettingsContext';
import { ADS_ID_RE, GA4_ID_RE, GTM_ID_RE } from '../../lib/gtag';

/**
 * "Google Ads & SEO" — the screen the owner asked for by name.
 *
 * He asked several times to be able to connect Google Ads himself, from the
 * dashboard, the way he connects Mollie. So this holds no secrets and needs no
 * server route: an Ads conversion id and a GA4 measurement id are PUBLIC
 * strings, they belong in the site settings the dashboard already writes, and
 * the browser reads them from there.
 *
 * The instructions are on the screen rather than in a message, because the last
 * two integrations stalled for days waiting on a step nobody had written down.
 */

const HELP_LINK = 'https://ads.google.com/aw/conversions';

function Field({
  label,
  hint,
  placeholder,
  value,
  onChange,
  valid,
  mono = true,
}: {
  label: string;
  hint: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  valid: boolean | null;
  mono?: boolean;
}) {
  return (
    <div>
      <label className="block text-[0.6875rem] font-black uppercase tracking-wider text-gray-500 mb-1.5">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        className={
          'w-full px-4 py-2.5 border rounded-2xl text-sm outline-none focus:ring-2 focus:ring-blue-500 ' +
          (mono ? 'font-mono ' : '') +
          (valid === false ? 'border-red-300 bg-red-50/50' : 'border-gray-200')
        }
      />
      <p className={'text-[0.6875rem] font-bold mt-1 ' + (valid === false ? 'text-red-600' : 'text-gray-400')}>
        {valid === false ? `Does not look like a valid id — expected ${placeholder}` : hint}
      </p>
    </div>
  );
}

/** One on/off setting with its consequence spelled out under it. */
function Switch({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 p-3.5 bg-gray-50 border border-gray-100 rounded-2xl cursor-pointer hover:border-gray-200 transition-colors">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 w-4 h-4 accent-blue-600 shrink-0"
      />
      <span className="min-w-0">
        <span className="block text-[0.75rem] font-black text-gray-800">{label}</span>
        <span className="block text-[0.6875rem] font-bold text-gray-400 leading-snug">{hint}</span>
      </span>
    </label>
  );
}

export default function MarketingAdmin() {
  const { settings, updateSettings } = useSiteSettings();

  const [adsId, setAdsId] = useState('');
  const [purchaseLabel, setPurchaseLabel] = useState('');
  const [ga4Id, setGa4Id] = useState('');
  const [gtmId, setGtmId] = useState('');
  const [adsDataRedaction, setAdsDataRedaction] = useState(false);
  const [urlPassthrough, setUrlPassthrough] = useState(false);
  const [trackViewItem, setTrackViewItem] = useState(false);
  const [trackAddToCart, setTrackAddToCart] = useState(false);
  const [trackBeginCheckout, setTrackBeginCheckout] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed whenever the live settings arrive or change, or Save would write
  // back the empty strings this screen started with — the same clobber that
  // has cost this shop its logo before.
  useEffect(() => {
    const m = settings.marketing;
    setAdsId(m?.adsId || '');
    setPurchaseLabel(m?.purchaseLabel || '');
    setGa4Id(m?.ga4Id || '');
    setGtmId(m?.gtmId || '');
    setAdsDataRedaction(m?.adsDataRedaction === true);
    setUrlPassthrough(m?.urlPassthrough === true);
    setTrackViewItem(m?.trackViewItem === true);
    setTrackAddToCart(m?.trackAddToCart === true);
    setTrackBeginCheckout(m?.trackBeginCheckout === true);
    // The whole object, not its parts: depending on the individual fields meant a
    // switch flipped elsewhere never reached this screen until something else
    // changed too.
  }, [settings.marketing]);

  const adsValid = adsId.trim() === '' ? null : ADS_ID_RE.test(adsId.trim());
  const ga4Valid = ga4Id.trim() === '' ? null : GA4_ID_RE.test(ga4Id.trim());
  const gtmValid = gtmId.trim() === '' ? null : GTM_ID_RE.test(gtmId.trim());
  const canSave = adsValid !== false && ga4Valid !== false && gtmValid !== false;

  /*
   * THESE THREE ARE FORMAT CHECKS, NOT CONNECTIONS.
   *
   * Each is a regular expression over a string the owner typed. It proves the id
   * LOOKS like an id — nothing has been sent to Google and Google has not
   * answered. The badges read "Connected" and they now read "ID saved — tag is
   * live", which is the whole of what is known: the tag is being injected with
   * that id. A well-formed but mistyped AW- number is indistinguishable from a
   * correct one here, and an emerald "Connected" over one would hide a campaign
   * that records no sales for as long as nobody checks Google's own screen.
   */
  const connected = useMemo(
    () => ADS_ID_RE.test((settings.marketing?.adsId || '').trim()),
    [settings.marketing?.adsId],
  );
  const analyticsConnected = useMemo(
    () => GA4_ID_RE.test((settings.marketing?.ga4Id || '').trim()),
    [settings.marketing?.ga4Id],
  );
  const containerConnected = useMemo(
    () => GTM_ID_RE.test((settings.marketing?.gtmId || '').trim()),
    [settings.marketing?.gtmId],
  );

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await updateSettings({
        marketing: {
          adsId: adsId.trim(),
          purchaseLabel: purchaseLabel.trim(),
          ga4Id: ga4Id.trim(),
          gtmId: gtmId.trim(),
          adsDataRedaction,
          urlPassthrough,
          trackViewItem,
          trackAddToCart,
          trackBeginCheckout,
        },
      });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ---------------------------------------------------------- ADS */}
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-gray-900 text-white flex items-center justify-center">
              <Megaphone className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-black text-gray-900">Google Ads</h3>
              <p className="text-[0.6875rem] font-bold text-gray-400">
                Reports a sale to your campaign when a customer actually pays
              </p>
            </div>
          </div>
          <span
            className={
              'inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[0.625rem] font-black uppercase tracking-wide shrink-0 ' +
              (connected ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')
            }
          >
            {connected ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
            <span>{connected ? 'ID saved — tag is live' : 'Not connected'}</span>
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field
            label="Conversion ID"
            placeholder="AW-123456789"
            hint="Google Ads → Goals → Conversions → your action → Tag setup. The AW- half."
            value={adsId}
            onChange={setAdsId}
            valid={adsValid}
          />
          <Field
            label="Conversion label"
            placeholder="AbC-D_efGh12ijkLmn"
            hint="The half after the slash in the same snippet. Optional, but without it Ads cannot tell your actions apart."
            value={purchaseLabel}
            onChange={setPurchaseLabel}
            valid={null}
          />
        </div>

        <ol className="text-[0.75rem] leading-relaxed text-gray-600 bg-gray-50 rounded-2xl p-4 space-y-1.5 list-decimal list-inside">
          <li>
            Open{' '}
            <a href={HELP_LINK} target="_blank" rel="noreferrer" className="font-bold text-blue-600 hover:underline">
              Google Ads → Conversions <ExternalLink className="w-3 h-3 inline" />
            </a>{' '}
            and create a <b>Website</b> conversion action for a <b>Purchase</b>.
          </li>
          <li>
            Choose <b>Use value from the tag</b> — the shop sends the real order total and currency, not a
            guessed number.
          </li>
          <li>
            On the Tag setup screen pick <b>Install the tag yourself</b> and copy the two values out of the
            snippet: <code className="font-mono">AW-…</code> above, and the label after the slash beside it.
          </li>
          <li>Paste both here and press Save. Nothing else is needed — the shop fires the conversion itself.</li>
        </ol>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Switch
            label="Recover conversions from Safari"
            hint="Passes the ad-click id between pages in the address bar instead of a cookie. Safari and Firefox throw the cookie away, so without this a real sale from a real ad is often reported as coming from nowhere."
            checked={urlPassthrough}
            onChange={setUrlPassthrough}
          />
          <Switch
            label="Send Google less about the page"
            hint="Strips the ad-click identifier from the address Google receives. Slightly less accurate attribution, slightly less handed over."
            checked={adsDataRedaction}
            onChange={setAdsDataRedaction}
          />
        </div>
      </div>

      {/* ----------------------------------------------------- ANALYTICS */}
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-gray-900 text-white flex items-center justify-center">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-black text-gray-900">Google Analytics 4</h3>
              <p className="text-[0.6875rem] font-bold text-gray-400">Visitor numbers, pages, and where they came from</p>
            </div>
          </div>
          <span
            className={
              'inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[0.625rem] font-black uppercase tracking-wide shrink-0 ' +
              (analyticsConnected ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500')
            }
          >
            {analyticsConnected ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
            <span>{analyticsConnected ? 'ID saved — tag is live' : 'Optional'}</span>
          </span>
        </div>

        <div className="md:w-1/2">
          <Field
            label="Measurement ID"
            placeholder="G-XXXXXXXXXX"
            hint="Analytics → Admin → Data streams → your web stream."
            value={ga4Id}
            onChange={setGa4Id}
            valid={ga4Valid}
          />
        </div>
      </div>

      {/* ------------------------------------------------- TAG MANAGER */}
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-gray-900 text-white flex items-center justify-center">
              <Tags className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-black text-gray-900">Google Tag Manager</h3>
              <p className="text-[0.6875rem] font-bold text-gray-400">
                Add any other tag yourself, without waiting for a new version of the shop
              </p>
            </div>
          </div>
          <span
            className={
              'inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[0.625rem] font-black uppercase tracking-wide shrink-0 ' +
              (containerConnected ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500')
            }
          >
            {containerConnected ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
            <span>{containerConnected ? 'ID saved — tag is live' : 'Optional'}</span>
          </span>
        </div>

        <div className="md:w-1/2">
          <Field
            label="Container ID"
            placeholder="GTM-ABC1234"
            hint="Tag Manager → your container → the code at the top of the screen."
            value={gtmId}
            onChange={setGtmId}
            valid={gtmValid}
          />
        </div>

        <p className="text-[0.75rem] leading-relaxed text-gray-600 bg-gray-50 rounded-2xl p-4">
          A container is a box you can put tags in from Google's own screen — a remarketing tag, a heat map, a
          Meta pixel — and none of them need a change to this shop. It obeys the same rule as everything else
          here: <b>nothing is loaded until a visitor accepts</b>. Whatever you put inside it is your
          responsibility under the same cookie law, so anything that tracks people belongs behind the same
          consent, and the cookie policy has to say it is there.
        </p>
      </div>

      {/* ------------------------------------------------------- EVENTS */}
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-5">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-2xl bg-gray-900 text-white flex items-center justify-center">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-black text-gray-900">What else to report</h3>
            <p className="text-[0.6875rem] font-bold text-gray-400">
              A completed sale is always reported. These are the steps before it.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Switch
            label="Product viewed"
            hint="Someone opened a product page. This is what builds a remarketing audience — the people to show the product to again."
            checked={trackViewItem}
            onChange={setTrackViewItem}
          />
          <Switch
            label="Added to basket"
            hint="A configured line went into the basket. The strongest signal Smart Bidding has short of a sale."
            checked={trackAddToCart}
            onChange={setTrackAddToCart}
          />
          <Switch
            label="Checkout started"
            hint="The customer pressed Pay and left for the bank. NOT counted as a sale — the sale is still only reported when the money actually arrives."
            checked={trackBeginCheckout}
            onChange={setTrackBeginCheckout}
          />
        </div>

        <p className="text-[0.75rem] leading-relaxed text-gray-600 bg-gray-50 rounded-2xl p-4">
          These cost you nothing and they are what Google needs to find more people like the ones who nearly
          bought. They are off by default because every one of them is data about a real person, and switching
          them on is a decision, not a default.
        </p>
      </div>

      {/* --------------------------------------------------- THE HONEST BIT */}
      <div className="bg-amber-50 border border-amber-200 rounded-3xl p-5 flex gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="text-[0.75rem] leading-relaxed text-amber-900 space-y-1.5">
          <p className="font-black">What happens the moment you save an id</p>
          <p>
            The shop starts asking every visitor for consent, because these tags set advertising cookies and
            EU law does not allow them without a yes. Visitors who refuse are not tracked and nothing is
            loaded for them — so the numbers Google reports will always be lower than your real traffic.
            That is normal and it is the law, not a fault.
          </p>
          <p>
            Clearing both fields switches all of it off again, and the consent banner goes back to being the
            short information notice it is today.
          </p>
        </div>
      </div>

      {/* ------------------------------------------------------------ SAVE */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving || !canSave}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-200 disabled:text-gray-400 text-white text-sm font-black rounded-2xl transition-colors flex items-center gap-2"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          <span>Save</span>
        </button>
        {saved && (
          <span className="text-[0.75rem] font-black text-emerald-700 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" /> Saved — live on the shop straight away
          </span>
        )}
        {error && <span className="text-[0.75rem] font-black text-red-600">{error}</span>}
      </div>
    </div>
  );
}
