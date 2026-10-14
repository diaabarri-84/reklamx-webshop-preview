import React, { useState } from 'react';
import { 
  Sparkles, 
  Link as LinkIcon, 
  Upload, 
  X, 
  Trash2, 
  Plus, 
  Check, 
  AlertCircle, 
  Layers, 
  Tag, 
  DollarSign, 
  Package, 
  Loader2, 
  FileText,
  ChevronUp,
  ChevronDown,
  Image as ImageIcon
} from 'lucide-react';
import { Category, Product, ProductOption } from '../../types';
import { categoryPickList } from '../../lib/categoryTree';
import { db, auth } from '../../firebase';
import { doc, setDoc } from 'firebase/firestore';
import { useAuth } from '../../App';
import { invalidateShopCache } from '../../lib/invalidateShopCache';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  categories: Category[];
  onProductCreated: (newProduct: Product) => void;
}

export default function CompetitorProductAnalyzerModal({
  isOpen,
  onClose,
  categories,
  onProductCreated
}: Props) {
  const { language, t } = useAuth();
  // Input States
  const [competitorUrl, setCompetitorUrl] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [notes, setNotes] = useState('');

  // Processing & Stage States
  const [stage, setStage] = useState<'input' | 'analyzing' | 'review'>('input');
  const [loadingText, setLoadingText] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Analyzed / Editable Product Form State
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [basePrice, setBasePrice] = useState<number>(150);
  const [minQuantity, setMinQuantity] = useState<number>(10);
  const [maxQuantity, setMaxQuantity] = useState<number>(5000);
  const [stock, setStock] = useState<number>(0);
  const [isWeb2Print, setIsWeb2Print] = useState(true);
  
  // Features List
  const [features, setFeatures] = useState<string[]>([]);
  const [newFeatureInput, setNewFeatureInput] = useState('');

  // Options & Specifications List
  const [options, setOptions] = useState<ProductOption[]>([]);

  // Images List
  const [productImages, setProductImages] = useState<string[]>([]);
  const [newImageUrl, setNewImageUrl] = useState('');

  // Saving State
  const [isSaving, setIsSaving] = useState(false);

  if (!isOpen) return null;

  // Handle Image File Attachment
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach(file => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        if (result) {
          setImages(prev => [...prev, result]);
        }
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const handleRemoveAttachedImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  };

  // Run AI Analysis
  const handleAnalyze = async () => {
    if (!competitorUrl.trim() && images.length === 0) {
      setErrorMessage('Please provide either a product URL or attach an image.');
      return;
    }

    setErrorMessage(null);
    setStage('analyzing');
    setLoadingText('Connecting to Gemini AI and analyzing product data...');

    try {
      const idToken = await auth.currentUser?.getIdToken();
      const response = await fetch('/api/analyze-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken ?? ''}` },
        body: JSON.stringify({
          url: competitorUrl.trim(),
          images: images,
          notes: notes.trim()
        })
      });

      // READ THE BODY BEFORE TRUSTING THE STATUS, and survive a body that is not
      // JSON at all: this host serves its own HTML 502 page, and an unguarded
      // res.json() turns that into "Unexpected token '<'" in the admin's banner —
      // which tells him nothing and sounds like his input.
      const data = await response.json().catch(() => null as any);

      if (!response.ok || !data?.success || !data?.product) {
        // The server writes a sentence meant for an admin, behind requireAdmin.
        // Throwing it away and printing "check your inputs" is what made the
        // owner re-paste a perfectly good URL over and over while the real cause
        // was a key or a retired model on the server.
        const serverSaid = typeof data?.error === 'string' ? data.error : '';
        throw new Error(
          serverSaid ||
            (response.status >= 500
              ? 'The server could not complete the analysis. This is a server or AI-key problem, not your input.'
              : 'The analysis failed. Please try again, or check the link and images.'),
        );
      }

      const p = data.product;

      // Populate draft editor fields
      setName(p.name || ('Imported Custom Product'));
      setDescription(p.description || '');
      
      // Match category
      const matchedCat = categories.find(c => 
        c.id === p.suggestedCategory || 
        c.name.toLowerCase().includes(p.suggestedCategory?.toLowerCase() || '')
      );
      setCategoryId(matchedCat ? matchedCat.id : (categories[0]?.id || 'general'));

      setBasePrice(p.basePrice || 150);
      setMinQuantity(p.minQuantity || 10);
      setMaxQuantity(p.maxQuantity || 5000);
      setStock(p.stock || 1000);
      setIsWeb2Print(p.isWeb2Print ?? true);
      setFeatures(p.features || []);

      // Convert options
      if (Array.isArray(p.options)) {
        const formattedOpts: ProductOption[] = p.options.map((opt: any, idx: number) => ({
          id: `opt-ai-${idx}-${Date.now()}`,
          name: opt.name || `Option Group ${idx + 1}`,
          type: 'select',
          values: Array.isArray(opt.values) 
            ? opt.values.map((v: any) => ({
                label: v.label || 'Choice',
                priceModifier: Number(v.priceModifier) || 0
              }))
            : [{ label: 'Default Choice', priceModifier: 0 }]
        }));
        setOptions(formattedOpts);
      } else {
        setOptions([]);
      }

      // Default product images
      const initialImgs = images.length > 0 
        ? images 
        : ['/placeholder-print.svg'];
      setProductImages(initialImgs);

      setStage('review');
    } catch (err: any) {
      console.error('Error analyzing competitor product:', err);
      setErrorMessage(String(err?.message ?? 'The analysis failed. Please try again.'));
      setStage('input');
    }
  };

  // Feature Operations (Add / Remove)
  const handleAddFeature = () => {
    if (!newFeatureInput.trim()) return;
    setFeatures(prev => [...prev, newFeatureInput.trim()]);
    setNewFeatureInput('');
  };

  const handleRemoveFeature = (idx: number) => {
    setFeatures(prev => prev.filter((_, i) => i !== idx));
  };

  // Options & Specifications Operations (Add Group, Remove Group, Edit Group Name, Add Value, Edit Value, Remove Value)
  const handleAddOptionGroup = () => {
    const newGroup: ProductOption = {
      id: `opt-${Date.now()}`,
      name: 'New Specification Group',
      type: 'select',
      values: [
        { label: 'Standard Choice', priceModifier: 0 }
      ]
    };
    setOptions(prev => [...prev, newGroup]);
  };

  const handleRemoveOptionGroup = (groupIndex: number) => {
    setOptions(prev => prev.filter((_, i) => i !== groupIndex));
  };

  /**
   * ARRANGE THEM — 15.5.4, and this is the screen he photographed.
   *
   * "هون ما قادر ارتبهم حسب الاولويه". Every handler in this file appends to the
   * end, and the order these arrive in is whatever the AI emitted while reading
   * the competitor's page. There was no control of any kind: no arrows, no drag,
   * no sort field. The array position IS the order, and it survives the save —
   * Firestore stores an array as one value, so a merge write keeps it intact.
   */
  const moveInArray = <T,>(list: T[], from: number, direction: -1 | 1): T[] => {
    const to = from + direction;
    if (from < 0 || to < 0 || to >= list.length) return list;
    const next = [...list];
    [next[from], next[to]] = [next[to], next[from]];
    return next;
  };

  /**
   * WHICH GROUPS HE ARRANGED HIMSELF — 15.5.7, and the analyzer had no part in
   * it until now.
   *
   * A field the owner has ordered by hand carries `keepOwnerOrder`, and the
   * garment-size grid on the storefront honours it; without the flag the grid
   * re-sorts the tiles into real size order. The two dashboard editors set it;
   * this screen's brand-new arrows did not, so a group he named "Size" here was
   * stored in his order, shown in his order in this modal, and then sorted
   * S → M → L on the product page — his original complaint, reopened on the
   * very screen he photographed.
   *
   * Only the groups he actually touched are stamped. Stamping every AI-built
   * list would switch garment ordering off for lists he never looked at, which
   * is the behaviour the flag exists to preserve.
   */
  const [arrangedGroups, setArrangedGroups] = useState<Set<string>>(new Set());
  const markArranged = (groupIndex: number) =>
    setOptions(prev => {
      const id = prev[groupIndex]?.id;
      if (id) setArrangedGroups(seen => (seen.has(id) ? seen : new Set(seen).add(id)));
      return prev;
    });

  const handleMoveOptionGroup = (groupIndex: number, direction: -1 | 1) => {
    setOptions(prev => moveInArray(prev, groupIndex, direction));
  };

  const handleMoveOptionValue = (groupIndex: number, valIndex: number, direction: -1 | 1) => {
    markArranged(groupIndex);
    setOptions(prev => prev.map((opt, i) => (
      i === groupIndex ? { ...opt, values: moveInArray(opt.values, valIndex, direction) } : opt
    )));
  };

  const handleUpdateOptionGroupName = (groupIndex: number, newName: string) => {
    setOptions(prev => prev.map((opt, i) => i === groupIndex ? { ...opt, name: newName } : opt));
  };

  const handleAddOptionValue = (groupIndex: number) => {
    setOptions(prev => prev.map((opt, i) => {
      if (i === groupIndex) {
        return {
          ...opt,
          values: [...opt.values, { label: 'New Choice', priceModifier: 0 }]
        };
      }
      return opt;
    }));
  };

  const handleUpdateOptionValue = (groupIndex: number, valIndex: number, label: string, priceModifier: number) => {
    setOptions(prev => prev.map((opt, i) => {
      if (i === groupIndex) {
        const updated = [...opt.values];
        updated[valIndex] = { label, priceModifier };
        return { ...opt, values: updated };
      }
      return opt;
    }));
  };

  const handleRemoveOptionValue = (groupIndex: number, valIndex: number) => {
    setOptions(prev => prev.map((opt, i) => {
      if (i === groupIndex) {
        return {
          ...opt,
          values: opt.values.filter((_, vI) => vI !== valIndex)
        };
      }
      return opt;
    }));
  };

  // Image Operations
  const handleAddProductImageUrl = () => {
    if (!newImageUrl.trim()) return;
    setProductImages(prev => [...prev, newImageUrl.trim()]);
    setNewImageUrl('');
  };

  const handleRemoveProductImage = (index: number) => {
    setProductImages(prev => prev.filter((_, i) => i !== index));
  };

  // Final Save Product
  const handleSaveProduct = async () => {
    if (!name.trim()) {
      alert('Please enter product name.');
      return;
    }

    const finalMin = Number(minQuantity);
    const finalMax = Number(maxQuantity);
    if (!Number.isFinite(finalMin) || !Number.isFinite(finalMax) || finalMin < 1 || finalMax < 1 || finalMin > finalMax) {
      alert(t('paQtyInvalid'));
      return;
    }

    setIsSaving(true);
    const newProductId = `prod-competitor-${Date.now()}`;

    const newProductObj: Product = {
      id: newProductId,
      name: name.trim(),
      description: description.trim(),
      categoryId: categoryId || (categories[0]?.id || 'general'),
      basePrice: Number(basePrice) || 0,
      minQuantity: finalMin,
      maxQuantity: finalMax,
      stock: Number.isFinite(stock) ? stock : 0,
      isWeb2Print: isWeb2Print,
      images: productImages.length > 0 ? productImages : ['/placeholder-print.svg'],
      features: features,
      /**
       * AND THE LIST THE CUSTOMER ACTUALLY SEES — 15.5.9.
       *
       * `options` (the old "Custom Product Options") is READ by neither the shop
       * nor the server: the storefront configurator renders `printingFields`. So
       * every option group typed into this screen reached the shop as an empty
       * configurator until the groups were converted here.
       *
       * `options` itself is no longer written. It was kept only because the
       * product dialog used to edit it; that section is gone (2026-10), and a
       * product that still carries the old array is offered a one-press
       * conversion instead. Writing it here would only make every analysed
       * product show that offer for groups that are already properties.
       *
       * Ids are minted per group and per choice: PrintingFieldOption is matched
       * by id everywhere in the shop, and `values` carries none. `value` is the
       * slug, which is what the colour and size heuristics read, and the first
       * choice is the pre-selected one exactly as the dialog's own handler does
       * it.
       */
      printingFields: options
        .filter((group) => group.name.trim() && group.values.length > 0)
        .map((group, gIdx) => {
          /**
           * THE ID DECIDES WHETHER HE CAN EVER EDIT THIS AGAIN.
           *
           * The product dialog's Custom attributes builder is
           * `formPrintingFields.filter(f => f.id.startsWith('custom-'))`, and
           * the catalogue-property list is whatever is in the shared library.
           * A field minted as `opt-ai-…` — which is what `group.id` always is,
           * because both creation paths set it — belongs to neither: it would
           * price the shopper correctly and appear in NO editor. The only place
           * its name and surcharge looked editable is the dialog's own
           * "Custom Product Options" section, which writes `product.options`,
           * a field no storefront code reads. His price change would go to a
           * dead array while the shop went on charging the old surcharge.
           */
          const fieldId = `custom-ai-${group.id || `g${gIdx}`}`;
          return {
            id: fieldId,
            name: group.name.trim(),
            group: 'product_builder' as const,
            enabled: true,
            // Only when he pressed an arrow on this group — see arrangedGroups.
            ...(group.id && arrangedGroups.has(group.id) ? { keepOwnerOrder: true } : {}),
            options: group.values
              .filter((choice) => choice.label.trim())
              .map((choice, cIdx) => ({
                id: `${fieldId}-${cIdx}`,
                label: choice.label.trim(),
                value: choice.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `choice-${cIdx}`,
                priceModifier: Number(choice.priceModifier) || 0,
              })),
          };
        })
        .filter((field) => field.options.length > 0),
      createdAt: new Date().toISOString()
    };

    try {
      // Save to Firestore database
      await setDoc(doc(db, 'products', newProductId), newProductObj, { merge: true });
      // The storefront serves a cached catalogue. Every other screen that
      // writes a product clears it; this one never did, so a product built
      // here did not appear in the shop until the cache expired on its own.
      void invalidateShopCache();

      // Notify parent component to update state
      onProductCreated(newProductObj);

      setIsSaving(false);
      onClose();
      resetForm();
    } catch (err) {
      console.error('Error saving imported product:', err);
      alert('Failed to save product to database.');
      setIsSaving(false);
    }
  };

  const resetForm = () => {
    setCompetitorUrl('');
    setImages([]);
    setNotes('');
    setStage('input');
    setErrorMessage(null);
  };

  return (
    <div className="fixed inset-0 z-50 bg-gray-900/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-fade-in">
      <div className="bg-white rounded-3xl max-w-4xl w-full shadow-2xl border border-gray-100 overflow-hidden my-auto max-h-[92vh] flex flex-col">
        
        {/* Modal Header */}
        <div className="bg-gradient-to-r from-gray-900 via-indigo-950 to-purple-950 p-5 sm:p-6 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3 rtl:space-x-reverse">
            <div className="w-11 h-11 bg-gradient-to-tr from-amber-400 to-orange-500 rounded-2xl flex items-center justify-center text-gray-900 shadow-md">
              <Sparkles className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-black flex items-center space-x-2 rtl:space-x-reverse">
                <span>{'AI Competitor Product Analyzer'}</span>
              </h2>
              <p className="text-xs text-gray-300 font-medium mt-0.5">
                {'Attach competitor URLs or product photos to automatically construct customizable store products'}
              </p>
            </div>
          </div>

          <button
            onClick={() => { onClose(); resetForm(); }}
            className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-6 flex-1">
          
          {errorMessage && (
            <div className="bg-red-50 border border-red-200 text-red-800 p-4 rounded-2xl flex items-center space-x-3 rtl:space-x-reverse text-xs sm:text-sm font-bold">
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* STAGE 1: INPUT FORM */}
          {stage === 'input' && (
            <div className="space-y-5">
              
              {/* Product URL Input */}
              <div className="space-y-1.5">
                <label className="block text-xs font-black text-gray-800 uppercase tracking-wider flex items-center space-x-2 rtl:space-x-reverse">
                  <LinkIcon className="w-4 h-4 text-orange-600" />
                  <span>{'Competitor Product URL'}</span>
                </label>
                <div className="relative">
                  <input
                    type="url"
                    value={competitorUrl}
                    onChange={(e) => setCompetitorUrl(e.target.value)}
                    placeholder={'https://competitor.com/product/...'}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-xs sm:text-sm font-semibold focus:bg-white focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500 outline-none transition-all"
                  />
                </div>
              </div>

              {/* Attach Images / Screenshots */}
              <div className="space-y-2">
                <label className="block text-xs font-black text-gray-800 uppercase tracking-wider flex items-center space-x-2 rtl:space-x-reverse">
                  <Upload className="w-4 h-4 text-orange-600" />
                  <span>{'Attach Competitor Product Images or Screenshots'}</span>
                </label>

                <div className="border-2 border-dashed border-gray-200 hover:border-orange-400 bg-gray-50/50 hover:bg-orange-50/30 transition-all rounded-3xl p-5 text-center">
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleImageUpload}
                    className="hidden"
                    id="competitor-image-upload"
                  />
                  <label htmlFor="competitor-image-upload" className="cursor-pointer flex flex-col items-center justify-center space-y-2">
                    <div className="w-12 h-12 bg-white rounded-2xl shadow-xs border border-gray-200 flex items-center justify-center text-orange-600">
                      <ImageIcon className="w-6 h-6" />
                    </div>
                    <div>
                      <span className="text-xs sm:text-sm font-bold text-gray-800 block">
                        {'Click to upload images or drag & drop'}
                      </span>
                      <span className="text-[0.6875rem] text-gray-400 font-medium">
                        {'Supports PNG, JPG, WEBP (Multiple files allowed)'}
                      </span>
                    </div>
                  </label>
                </div>

                {/* Image Thumbnails */}
                {images.length > 0 && (
                  <div className="flex flex-wrap gap-3 pt-2">
                    {images.map((img, idx) => (
                      <div key={idx} className="relative w-20 h-20 rounded-2xl overflow-hidden border border-gray-200 group shadow-xs">
                        <img src={img} alt="Attached competitor preview" className="w-full h-full object-cover" />
                        <button
                          onClick={() => handleRemoveAttachedImage(idx)}
                          className="absolute top-1 right-1 bg-red-600 text-white rounded-full p-1 opacity-90 hover:opacity-100 transition-opacity shadow-sm"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Extra Notes / Instructions */}
              <div className="space-y-1.5">
                <label className="block text-xs font-black text-gray-800 uppercase tracking-wider flex items-center space-x-2 rtl:space-x-reverse">
                  <FileText className="w-4 h-4 text-orange-600" />
                  <span>{'Additional Notes / Instructions (Optional)'}</span>
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder={'e.g. Set base price to $25 and localize specifications...'}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-xs sm:text-sm font-medium focus:bg-white focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500 outline-none transition-all resize-none"
                />
              </div>

              {/* Start Analysis Button */}
              <button
                onClick={handleAnalyze}
                className="w-full py-4 bg-gradient-to-r from-orange-600 via-amber-600 to-yellow-600 text-white font-extrabold text-sm rounded-2xl hover:opacity-95 transition-all shadow-lg shadow-orange-500/20 flex items-center justify-center space-x-2 rtl:space-x-reverse active:scale-98"
              >
                <Sparkles className="w-5 h-5 text-amber-200" />
                <span>{'Start AI Analysis & Extract Product Specs'}</span>
              </button>
            </div>
          )}

          {/* STAGE 2: ANALYZING LOADER */}
          {stage === 'analyzing' && (
            <div className="py-16 flex flex-col items-center justify-center text-center space-y-4">
              <div className="relative">
                <div className="w-20 h-20 rounded-3xl bg-gradient-to-tr from-orange-500 via-purple-600 to-indigo-600 animate-spin flex items-center justify-center p-1 shadow-xl">
                  <div className="w-full h-full bg-white rounded-2xl flex items-center justify-center">
                    <Sparkles className="w-8 h-8 text-orange-600 animate-pulse" />
                  </div>
                </div>
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-black text-gray-900">
                  {'Analyzing Competitor Product...'}
                </h3>
                <p className="text-xs text-gray-500 font-bold max-w-md">
                  {loadingText}
                </p>
              </div>
            </div>
          )}

          {/* STAGE 3: EDITABLE DRAFT REVIEW (مع إمكانية التعديل والحذف والإضافة) */}
          {stage === 'review' && (
            <div className="space-y-6 animate-fade-in">
              
              {/* Top Banner Notice */}
              <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-4 rounded-2xl flex items-center justify-between text-xs sm:text-sm font-bold">
                <div className="flex items-center space-x-2.5 rtl:space-x-reverse">
                  <Check className="w-5 h-5 text-emerald-600 shrink-0" />
                  <span>
                    {'Product specs successfully extracted! You can edit, add, or remove any properties below.'}
                  </span>
                </div>
                <button
                  onClick={() => setStage('input')}
                  className="text-xs text-emerald-700 underline font-extrabold hover:text-emerald-900 shrink-0"
                >
                  {'Re-analyze'}
                </button>
              </div>

              {/* 1. Basic Product Info */}
              <div className="bg-gray-50/80 p-4 sm:p-5 rounded-2xl border border-gray-200/80 space-y-4">
                <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider flex items-center space-x-2 rtl:space-x-reverse">
                  <Tag className="w-4 h-4 text-orange-600" />
                  <span>{'Basic Product Information'}</span>
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Name */}
                  <div className="space-y-1 sm:col-span-2">
                    <label className="block text-[0.6875rem] font-black text-gray-700 uppercase">
                      {'Product Name'}
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl text-xs sm:text-sm font-bold text-gray-900 focus:ring-2 focus:ring-orange-500/30 outline-none"
                    />
                  </div>

                  {/* Category Selection */}
                  <div className="space-y-1">
                    <label className="block text-[0.6875rem] font-black text-gray-700 uppercase">
                      {'Store Category'}
                    </label>
                    <select
                      value={categoryId}
                      onChange={(e) => setCategoryId(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl text-xs font-bold text-gray-900 focus:ring-2 focus:ring-orange-500/30 outline-none"
                    >
                      {categoryPickList(categories).map(({ category: cat, indent }) => (
                        <option key={cat.id} value={cat.id}>{indent}{cat.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Base Price */}
                  <div className="space-y-1">
                    <label className="block text-[0.6875rem] font-black text-gray-700 uppercase">
                      {'Base Price'}
                    </label>
                    <input
                      type="number"
                      value={basePrice}
                      onChange={(e) => setBasePrice(Number(e.target.value))}
                      className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl text-xs sm:text-sm font-extrabold text-orange-600 focus:ring-2 focus:ring-orange-500/30 outline-none"
                    />
                  </div>

                  {/* Min Quantity & Max Quantity */}
                  <div className="space-y-1">
                    <label className="block text-[0.6875rem] font-black text-gray-700 uppercase">
                      {'Minimum Order Qty'}
                    </label>
                    <input
                      type="number"
                      value={minQuantity}
                      onChange={(e) => setMinQuantity(Number(e.target.value))}
                      className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl text-xs font-bold text-gray-900 focus:ring-2 focus:ring-orange-500/30 outline-none"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block text-[0.6875rem] font-black text-gray-700 uppercase">
                      {'Initial Stock'}
                    </label>
                    <input
                      type="number"
                      value={stock}
                      onChange={(e) => setStock(Number(e.target.value))}
                      className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl text-xs font-bold text-gray-900 focus:ring-2 focus:ring-orange-500/30 outline-none"
                    />
                  </div>

                  {/* Description */}
                  <div className="space-y-1 sm:col-span-2">
                    <label className="block text-[0.6875rem] font-black text-gray-700 uppercase">
                      {'Product Description'}
                    </label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={3}
                      className="w-full px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl text-xs font-medium text-gray-800 focus:ring-2 focus:ring-orange-500/30 outline-none resize-none"
                    />
                  </div>
                </div>
              </div>

              {/* 2. Product Features & Highlights (مميزات وخصائص المنتج) */}
              <div className="bg-gray-50/80 p-4 sm:p-5 rounded-2xl border border-gray-200/80 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider flex items-center space-x-2 rtl:space-x-reverse">
                    <Layers className="w-4 h-4 text-orange-600" />
                    <span>{'Product Features'}</span>
                  </h3>
                  <span className="text-[0.6875rem] font-bold text-gray-500">
                    {features.length} {'features'}
                  </span>
                </div>

                <div className="space-y-2">
                  {features.map((feat, fIdx) => (
                    <div key={fIdx} className="flex items-center space-x-2 rtl:space-x-reverse bg-white p-2 rounded-xl border border-gray-200">
                      <input
                        type="text"
                        value={feat}
                        onChange={(e) => {
                          const updated = [...features];
                          updated[fIdx] = e.target.value;
                          setFeatures(updated);
                        }}
                        className="flex-1 text-xs font-bold text-gray-800 outline-none px-2 py-1 bg-transparent"
                      />
                      {/* 15.5.6 — the bullet list is ordered too, and unlike the
                          option groups it has ALWAYS been customer-facing: the
                          product page prints it top to bottom. */}
                      <button
                        onClick={() => setFeatures(prev => moveInArray(prev, fIdx, -1))}
                        disabled={fIdx === 0}
                        title="Move up"
                        className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-25 disabled:hover:bg-transparent"
                      >
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setFeatures(prev => moveInArray(prev, fIdx, 1))}
                        disabled={fIdx === features.length - 1}
                        title="Move down"
                        className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-25 disabled:hover:bg-transparent"
                      >
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleRemoveFeature(fIdx)}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title={'Remove feature'}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}

                  {/* Add New Feature */}
                  <div className="flex items-center space-x-2 rtl:space-x-reverse pt-1">
                    <input
                      type="text"
                      value={newFeatureInput}
                      onChange={(e) => setNewFeatureInput(e.target.value)}
                      placeholder={'Add a new product feature...'}
                      className="flex-1 px-3.5 py-2 bg-white border border-gray-200 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-orange-500/30"
                      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddFeature())}
                    />
                    <button
                      onClick={handleAddFeature}
                      className="px-4 py-2 bg-gray-900 text-white rounded-xl text-xs font-bold hover:bg-gray-800 transition-colors flex items-center space-x-1 shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>{'Add'}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* 3. Customizable Specifications & Options (الخيارات المخصصة - ورق، تغليف، مقاسات) */}
              <div className="bg-gray-50/80 p-4 sm:p-5 rounded-2xl border border-gray-200/80 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider flex items-center space-x-2 rtl:space-x-reverse">
                      <Package className="w-4 h-4 text-orange-600" />
                      <span>{'Custom Product Options'}</span>
                    </h3>
                    <p className="text-[0.6875rem] text-gray-400 font-medium">
                      {'Manage substrates, finishing charges, and option choices'}
                    </p>
                  </div>

                  <button
                    onClick={handleAddOptionGroup}
                    className="px-3.5 py-2 bg-orange-600 text-white rounded-xl text-xs font-bold hover:bg-orange-700 transition-colors flex items-center space-x-1 shadow-xs shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{'Add Option Group'}</span>
                  </button>
                </div>

                {options.length === 0 ? (
                  <div className="text-center py-6 bg-white rounded-2xl border border-dashed border-gray-200 text-gray-400 text-xs font-medium">
                    {'No custom option groups yet. Click "Add Option Group" above.'}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {options.map((optGroup, gIdx) => (
                      <div key={optGroup.id || gIdx} className="bg-white p-4 rounded-2xl border border-gray-200 space-y-3 shadow-2xs">
                        
                        {/* Option Group Title & Remove Group */}
                        <div className="flex items-center justify-between gap-2 pb-2 border-b border-gray-100">
                          <input
                            type="text"
                            value={optGroup.name}
                            onChange={(e) => handleUpdateOptionGroupName(gIdx, e.target.value)}
                            className="text-xs font-black text-gray-900 bg-transparent outline-none focus:bg-gray-50 px-2 py-1 rounded-lg border border-transparent focus:border-gray-200 w-full max-w-md"
                          />

                          <button
                            onClick={() => handleMoveOptionGroup(gIdx, -1)}
                            disabled={gIdx === 0}
                            title="Move group up"
                            className="p-1.5 rounded-xl text-gray-500 hover:bg-gray-100 disabled:opacity-25 disabled:hover:bg-transparent shrink-0"
                          >
                            <ChevronUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleMoveOptionGroup(gIdx, 1)}
                            disabled={gIdx === options.length - 1}
                            title="Move group down"
                            className="p-1.5 rounded-xl text-gray-500 hover:bg-gray-100 disabled:opacity-25 disabled:hover:bg-transparent shrink-0"
                          >
                            <ChevronDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleRemoveOptionGroup(gIdx)}
                            className="p-1.5 text-red-500 hover:bg-red-50 rounded-xl transition-colors text-xs font-bold flex items-center space-x-1 shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>{'Delete Group'}</span>
                          </button>
                        </div>

                        {/* Choices List */}
                        <div className="space-y-2">
                          {optGroup.values.map((choice, cIdx) => (
                            <div key={cIdx} className="flex items-center gap-2 bg-gray-50/60 p-2 rounded-xl border border-gray-200/70">
                              <div className="flex-1">
                                <span className="text-[0.625rem] font-bold text-gray-400 block mb-0.5">{'Choice Label'}</span>
                                <input
                                  type="text"
                                  value={choice.label}
                                  onChange={(e) => handleUpdateOptionValue(gIdx, cIdx, e.target.value, choice.priceModifier)}
                                  className="w-full px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-bold text-gray-800 outline-none"
                                />
                              </div>

                              <div className="w-28 shrink-0">
                                <span className="text-[0.625rem] font-bold text-gray-400 block mb-0.5">{'+ Price Extra'}</span>
                                <input
                                  type="number"
                                  value={choice.priceModifier}
                                  onChange={(e) => handleUpdateOptionValue(gIdx, cIdx, choice.label, Number(e.target.value))}
                                  className="w-full px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-extrabold text-orange-600 outline-none"
                                />
                              </div>

                              <button
                                onClick={() => handleMoveOptionValue(gIdx, cIdx, -1)}
                                disabled={cIdx === 0}
                                title="Move up"
                                className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors mt-4 shrink-0 disabled:opacity-25 disabled:hover:bg-transparent"
                              >
                                <ChevronUp className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleMoveOptionValue(gIdx, cIdx, 1)}
                                disabled={cIdx === optGroup.values.length - 1}
                                title="Move down"
                                className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors mt-4 shrink-0 disabled:opacity-25 disabled:hover:bg-transparent"
                              >
                                <ChevronDown className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleRemoveOptionValue(gIdx, cIdx)}
                                className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors mt-4 shrink-0"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}

                          {/* Add Choice to Group */}
                          <button
                            onClick={() => handleAddOptionValue(gIdx)}
                            className="w-full py-2 bg-gray-50 hover:bg-gray-100 border border-dashed border-gray-200 rounded-xl text-xs font-bold text-gray-700 transition-colors flex items-center justify-center space-x-1"
                          >
                            <Plus className="w-3.5 h-3.5 text-orange-600" />
                            <span>{'Add Choice to Group'}</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 4. Product Images Section */}
              <div className="bg-gray-50/80 p-4 sm:p-5 rounded-2xl border border-gray-200/80 space-y-3">
                <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider flex items-center space-x-2 rtl:space-x-reverse">
                  <ImageIcon className="w-4 h-4 text-orange-600" />
                  <span>{'Product Images'}</span>
                </h3>

                <div className="flex flex-wrap gap-3">
                  {productImages.map((imgUrl, imgIdx) => (
                    <div key={imgIdx} className="relative w-24 h-24 rounded-2xl overflow-hidden border border-gray-200 shadow-2xs group">
                      <img src={imgUrl} alt="Product preview" className="w-full h-full object-cover" />
                      <button
                        onClick={() => handleRemoveProductImage(imgIdx)}
                        className="absolute top-1 right-1 bg-red-600 text-white rounded-full p-1 opacity-90 hover:opacity-100 transition-opacity shadow-sm"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="flex items-center space-x-2 rtl:space-x-reverse pt-1">
                  <input
                    type="text"
                    value={newImageUrl}
                    onChange={(e) => setNewImageUrl(e.target.value)}
                    placeholder="https://images.unsplash.com/photo-..."
                    className="flex-1 px-3.5 py-2 bg-white border border-gray-200 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-orange-500/30"
                  />
                  <button
                    onClick={handleAddProductImageUrl}
                    className="px-4 py-2 bg-gray-900 text-white rounded-xl text-xs font-bold hover:bg-gray-800 transition-colors shrink-0"
                  >
                    {'Add Image'}
                  </button>
                </div>
              </div>

            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div className="bg-gray-50 p-4 sm:p-5 border-t border-gray-100 flex items-center justify-between shrink-0">
          <button
            onClick={() => { onClose(); resetForm(); }}
            className="px-5 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-2xl text-xs sm:text-sm font-bold hover:bg-gray-100 transition-colors"
          >
            {'Cancel'}
          </button>

          {stage === 'review' && (
            <button
              onClick={handleSaveProduct}
              disabled={isSaving}
              className="px-6 py-3 bg-gradient-to-r from-emerald-600 via-teal-600 to-green-600 text-white font-extrabold text-xs sm:text-sm rounded-2xl hover:opacity-95 transition-all shadow-lg shadow-emerald-500/20 flex items-center space-x-2 rtl:space-x-reverse disabled:opacity-50 active:scale-98"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{'Saving...'}</span>
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  <span>{'Save & Add Product to Store'}</span>
                </>
              )}
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
