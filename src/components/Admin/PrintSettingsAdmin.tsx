import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { PrintSettings } from '../../types';
import { useAuth } from '../../App';
import { CurrencyCode } from '../../lib/currency';
import { 
  Settings, 
  Save, 
  Check, 
  Plus, 
  X, 
  Ruler, 
  Calculator, 
  DollarSign, 
  FileCheck, 
  Sparkles,
  Info,
  Coins,
  RefreshCw, Percent, ShieldAlert } from 'lucide-react';
import { motion } from 'motion/react';

const DEFAULT_SETTINGS: PrintSettings = {
  maxWidthCm: 28,
  pricePerLinearMeter: 250,
  minPrice: 149,
  vatRatePercent: 25,
  allowedFormats: ['pdf', 'png', 'jpg', 'jpeg', 'svg', 'eps', 'tiff', 'psd', 'ai'],
  currencySymbol: 'kr'
};

export default function PrintSettingsAdmin() {
  const { user, t, currency, currencies, updateExchangeRate } = useAuth();
  const [settings, setSettings] = useState<PrintSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [newExtension, setNewExtension] = useState('');

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const docRef = doc(db, 'settings', 'printSettings');
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          setSettings({ ...DEFAULT_SETTINGS, ...snap.data() as PrintSettings });
        }
      } catch (err) {
        console.warn('Notice fetching print settings (using defaults):', err);
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSavedSuccess(false);
    try {
      const docRef = doc(db, 'settings', 'printSettings');
      // Write only the fields THIS form owns.
      //
      // It used to write the whole `settings` object, which was a snapshot of
      // the document taken when the screen opened. Exchange rates live in the
      // same document and are saved the instant they are typed, further up this
      // very page — so editing a rate and then pressing Save put the old rates
      // straight back, on the same screen, with a green tick.
      await setDoc(
        docRef,
        {
          maxWidthCm: settings.maxWidthCm,
          pricePerLinearMeter: settings.pricePerLinearMeter,
          minPrice: settings.minPrice,
          vatRatePercent: settings.vatRatePercent,
          allowedFormats: settings.allowedFormats,
          currencySymbol: settings.currencySymbol,
          maxFileSizeMb: settings.maxFileSizeMb ?? null,
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 4000);
    } catch (err) {
      console.error('Error saving settings:', err);
      alert(t('umChangeFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleAddExtension = () => {
    if (!newExtension.trim()) return;
    const cleanExt = newExtension.trim().toLowerCase().replace('.', '');
    if (!settings.allowedFormats.includes(cleanExt)) {
      setSettings(prev => ({
        ...prev,
        allowedFormats: [...prev.allowedFormats, cleanExt]
      }));
    }
    setNewExtension('');
  };

  const handleRemoveExtension = (ext: string) => {
    setSettings(prev => ({
      ...prev,
      allowedFormats: prev.allowedFormats.filter(f => f !== ext)
    }));
  };

  // Defense in depth: RequireRole already wraps the route, but the other admin
  // panels also refuse to render for the wrong role.
  if (user?.role !== 'admin') {
    return (
      <div className="bg-red-50 border border-red-200 rounded-3xl p-8 text-center space-y-4">
        <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-black text-red-950">
          {t('cpDeniedTitle')}
        </h2>
        <p className="text-sm font-semibold text-red-700 max-w-md mx-auto">
          {t('psDeniedBody')}
        </p>
      </div>
    );
  }

  if (loading) {
    return <div className="p-8 text-center font-bold text-gray-500">Loading settings...</div>;
  }

  return (
    <div className="bg-white rounded-3xl p-8 border border-gray-100 shadow-sm space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-gray-100 pb-6 gap-4">
        <div>
          <div className="inline-flex items-center px-3 py-1 bg-blue-50 text-blue-700 text-xs font-bold rounded-full mb-2">
            <Sparkles className="w-3.5 h-3.5 mr-1.5" />
            {'Admin Control'}
          </div>
          <h2 className="text-2xl font-black text-gray-900">
            {'Custom File Upload & Pricing Rules'}
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            {'Configure max upload width, linear meter rate, minimum price, and allowed file formats for custom prints.'}
          </p>
        </div>

        <button 
          onClick={handleSave}
          disabled={saving}
          className="flex items-center px-6 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-all shadow-lg hover:shadow-blue-500/25 active:scale-95 disabled:opacity-50"
        >
          {savedSuccess ? (
            <>
              <Check className="w-5 h-5 mr-2" />
              {'Saved Successfully!'}
            </>
          ) : (
            <>
              <Save className="w-5 h-5 mr-2" />
              {'Save Print Settings'}
            </>
          )}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Max Width Input */}
        <div className="bg-gray-50 p-6 rounded-2xl border border-gray-100 space-y-3">
          <div className="flex items-center space-x-2 text-blue-600 font-bold text-sm">
            <Ruler className="w-5 h-5" />
            <span>{'Max Width Limit (cm)'}</span>
          </div>
          <input 
            type="number" 
            value={settings.maxWidthCm} 
            onChange={(e) => setSettings({ ...settings, maxWidthCm: parseFloat(e.target.value) || 28 })}
            className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl font-extrabold text-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-500">
            {'Default maximum print width limit is 28 cm.'}
          </p>
        </div>

        {/* Price per Linear Meter Input */}
        <div className="bg-gray-50 p-6 rounded-2xl border border-gray-100 space-y-3">
          <div className="flex items-center space-x-2 text-blue-600 font-bold text-sm">
            <Calculator className="w-5 h-5" />
            <span>{'Price per Linear Meter (kr)'}</span>
          </div>
          <input 
            type="number" 
            value={settings.pricePerLinearMeter} 
            onChange={(e) => setSettings({ ...settings, pricePerLinearMeter: parseFloat(e.target.value) || 250 })}
            className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl font-extrabold text-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-500">
            {'Price per 100 cm height in Kronor (e.g. 250 kr).'}
          </p>
        </div>

        {/* Minimum Order Price Input */}
        <div className="bg-gray-50 p-6 rounded-2xl border border-gray-100 space-y-3">
          <div className="flex items-center space-x-2 text-blue-600 font-bold text-sm">
            <DollarSign className="w-5 h-5" />
            <span>{'Minimum Order Price (kr)'}</span>
          </div>
          <input 
            type="number" 
            value={settings.minPrice} 
            onChange={(e) => setSettings({ ...settings, minPrice: parseFloat(e.target.value) || 149 })}
            className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl font-extrabold text-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-500">
            {'Minimum price threshold per item (e.g. 149 kr).'}
          </p>
        </div>

        {/* VAT rate. Was hardcoded to 25% in three separate files. */}
        <div className="bg-gray-50 p-6 rounded-2xl border border-gray-100 space-y-3">
          <div className="flex items-center space-x-2 text-blue-600 font-bold text-sm">
            <Percent className="w-5 h-5" />
            <span>{'VAT / Moms (%)'}</span>
          </div>
          <input
            type="number"
            min={0}
            max={100}
            step={0.5}
            value={settings.vatRatePercent ?? 25}
            onChange={(e) => setSettings({ ...settings, vatRatePercent: parseFloat(e.target.value) || 0 })}
            className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl font-extrabold text-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-500">
            {'Swedish standard rate is 25%. Prices are entered without VAT and this is added on top.'}
          </p>
        </div>
      </div>

      {/* Exchange Rates Management Handler */}
      <div className="bg-gray-50 p-6 rounded-2xl border border-gray-100 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 text-gray-900 font-bold text-base">
            <Coins className="w-5 h-5 text-orange-600" />
            <span>Exchange Rates Configuration (Base: SEK 1.0)</span>
          </div>
          <span className="text-xs font-semibold text-gray-500">
            Active Display Currency: <span className="font-extrabold text-orange-600">{currency}</span>
          </span>
        </div>

        <p className="text-xs text-gray-500">
          Set custom exchange multipliers for each supported currency. Rates convert base prices (SEK) to client display currencies dynamically.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 pt-2">
          {(Object.keys(currencies) as CurrencyCode[]).map((code) => {
            const curr = currencies[code];
            const isBase = code === 'SEK';

            return (
              <div 
                key={code}
                className="bg-white p-4 rounded-xl border border-gray-200 shadow-2xs space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5 space-x-reverse">
                    <span className="text-lg">{curr.flag}</span>
                    <span className="font-extrabold text-sm text-gray-900">{curr.code}</span>
                  </div>
                  <span className="text-xs font-bold text-gray-400">({curr.symbol})</span>
                </div>

                <div className="text-[0.625rem] text-gray-500 font-medium">{curr.name}</div>

                {isBase ? (
                  <div className="w-full py-2 bg-gray-100 rounded-lg text-center text-xs font-black text-gray-600">
                    Base Currency (1.00)
                  </div>
                ) : (
                  <div className="flex items-center space-x-1 space-x-reverse">
                    <span className="text-xs font-bold text-gray-400">x</span>
                    <input
                      type="number"
                      step="0.001"
                      key={`${code}-${curr.rateFromSEK}`}
                      defaultValue={curr.rateFromSEK}
                      onBlur={(e) => updateExchangeRate(code, parseFloat(e.target.value) || 0.001)}
                      className="w-full px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg font-mono text-xs font-bold text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                )}
                
                <p className="text-[0.5625rem] text-gray-400 text-center">
                  100 SEK = {(100 * curr.rateFromSEK).toFixed(2)} {curr.symbol}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Allowed Extensions Management */}
      <div className="bg-gray-50 p-6 rounded-2xl border border-gray-100 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 text-gray-900 font-bold text-base">
            <FileCheck className="w-5 h-5 text-blue-600" />
            <span>{'Allowed File Formats Configuration'}</span>
          </div>
          <span className="text-xs font-semibold text-gray-500">
            {settings.allowedFormats.length} {'Formats active'}
          </span>
        </div>

        <p className="text-xs text-gray-500">
          {'Add or remove file extensions that customers are permitted to upload.'}
        </p>

        {/* Existing Extension Badges */}
        <div className="flex flex-wrap gap-2 pt-2">
          {settings.allowedFormats.map((ext) => (
            <span 
              key={ext}
              className="inline-flex items-center px-3.5 py-1.5 bg-white border border-gray-200 text-gray-800 font-extrabold text-xs rounded-xl shadow-sm hover:border-red-300 transition-colors"
            >
              <span className="uppercase mr-1.5">.{ext}</span>
              <button 
                onClick={() => handleRemoveExtension(ext)}
                className="text-gray-400 hover:text-red-600 transition-colors p-0.5"
                title="Remove format"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </span>
          ))}
        </div>

        {/* Add Extension Input */}
        <div className="flex items-center space-x-2 pt-4 max-w-md">
          <input 
            type="text" 
            placeholder={'Enter extension (e.g. psd, ai, pdf)'}
            value={newExtension}
            onChange={(e) => setNewExtension(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddExtension()}
            className="flex-1 px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button 
            onClick={handleAddExtension}
            className="px-4 py-2.5 bg-gray-900 text-white font-bold text-sm rounded-xl hover:bg-gray-800 transition-colors flex items-center"
          >
            <Plus className="w-4 h-4 mr-1" />
            {'Add Extension'}
          </button>
        </div>
      </div>
    </div>
  );
}
