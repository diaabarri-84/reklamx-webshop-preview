import React, { useState, useEffect, useMemo } from 'react';
import { withoutUndefined } from '../../lib/withoutUndefined';
import { collection, getDocs, doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useConfirmDialog } from '../ConfirmDialog';
import { useAuth } from '../../App';
import { Product, Category, PrintingField, PrintingFieldOption, CustomUploadRules, PricingRules, PrintingFieldGroupType, LocalizedText } from '../../types';
import { OPTION_CATALOGUE } from './optionCatalogue';
import { uploadOptionImage } from '../../lib/uploadOptionImage';
import { bulkProducts } from '../../lib/bulkProducts';
import { PRICING_DEFAULTS } from '../../lib/pricing';
import { categoryPickList } from '../../lib/categoryTree';

/** The shop's languages other than English, which lives in the plain field. */
type ShopLanguage = 'sv' | 'da' | 'no';
const SHOP_LANGUAGES: { code: ShopLanguage; name: string }[] = [
  { code: 'sv', name: 'Svenska' },
  { code: 'da', name: 'Dansk' },
  { code: 'no', name: 'Norsk' },
];
import {
  Calculator,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  DollarSign,
  Folder,
  HelpCircle,
  Info,
  Layers,
  Loader2,
  Package,
  Percent,
  Plus,
  Ruler,
  Save,
  Settings,
  ShieldAlert,
  Sliders,
  Sparkles,
  Tag,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../lib/utils';
import { LocalizedTextFields } from './LocalizedTextFields';
import PrintingFieldEditorBody, { type FieldPatch, type OptionPatch } from './PrintingFieldEditorBody';
import SortableList, { DragHandle } from './SortableList';
import { reorderById, reorderSubset } from '../../lib/reorder';
import type { LibraryApplyMode } from '../../lib/libraryApply';

/** Firestore doc holding the admin-edited option catalogue: settings/optionLibrary */
export const OPTION_LIBRARY_DOC = 'optionLibrary';

/**
 * The original hand-written fields. Kept ahead of the generated catalogue
 * because live products already reference these ids; dropping them would hide
 * those products' own options from the toggle grid in the product editor.
 */
const LEGACY_PRINTING_FIELDS: PrintingField[] = [
  // Default fields
  {
    id: 'default_field',
    code: '1',
    name: 'Default field',
    nameI18n: { sv: 'Standardfält', da: 'Standardfelt', no: 'Standardfelt' },
    group: 'default',
    enabled: true,
    options: [
      { id: 'df-1', label: 'Standard Configuration', value: 'standard', priceModifier: 0, isDefault: true, labelI18n: { sv: 'Standardkonfiguration', da: 'Standardkonfiguration', no: 'Standardkonfigurasjon' } }
    ]
  },
  {
    id: 'delivery_date',
    code: '30',
    name: 'Delivery date',
    nameI18n: { sv: 'Leveransdatum', da: 'Leveringsdato', no: 'Leveringsdato' },
    group: 'default',
    enabled: true,
    options: [
      { id: 'dd-1', label: 'Standard Delivery (3-5 Days)', value: 'standard', priceModifier: 0, isDefault: true, labelI18n: { sv: 'Standardleverans (3-5 dagar)', da: 'Standardlevering (3-5 dage)', no: 'Standardlevering (3-5 dager)' } },
      { id: 'dd-2', label: 'Express Delivery (1-2 Days)', value: 'express', priceModifier: 95, chargeOnce: true, labelI18n: { sv: 'Expressleverans (1-2 dagar)', da: 'Ekspreslevering (1-2 dage)', no: 'Ekspresslevering (1-2 dager)' } },
      { id: 'dd-3', label: 'Same-Day Production (24h)', value: 'urgent', priceModifier: 250, chargeOnce: true, labelI18n: { sv: 'Produktion samma dag (24h)', da: 'Produktion samme dag (24h)', no: 'Produksjon samme dag (24h)' } }
    ]
  },
  {
    id: 'artwork_actions',
    code: '31',
    name: 'Artwork actions',
    nameI18n: { sv: 'Åtgärder för original', da: 'Handlinger for original', no: 'Handlinger for original' },
    group: 'default',
    enabled: true,
    options: [
      { id: 'aa-1', label: 'Automatic Preflight Check', value: 'auto_check', priceModifier: 0, isDefault: true, labelI18n: { sv: 'Automatisk preflight-kontroll', da: 'Automatisk preflight-kontrol', no: 'Automatisk preflight-kontroll' } },
      { id: 'aa-2', label: 'Manual Designer Proof & Fixes', value: 'manual_proof', priceModifier: 85, chargeOnce: true, labelI18n: { sv: 'Manuell designkorrektur och rättning', da: 'Manuel designkorrektur og rettelser', no: 'Manuell designkorrektur og rettelser' } }
    ]
  },

  // Online design fields
  {
    id: 'sides_pages',
    code: '2',
    name: 'Sides/Pages',
    nameI18n: { sv: 'Trycksidor', da: 'Tryksider', no: 'Trykksider' },
    group: 'online_design',
    enabled: true,
    options: [
      { id: 'sp-1', label: 'Single Sided (1 Side)', value: 'single', priceModifier: 0, isDefault: true, labelI18n: { sv: 'Enkelsidigt (1 sida)', da: 'Enkeltsidet (1 side)', no: 'Enkeltsidig (1 side)' } },
      { id: 'sp-2', label: 'Double Sided (2 Sides)', value: 'double', priceModifier: 35, labelI18n: { sv: 'Dubbelsidigt (2 sidor)', da: 'Dobbeltsidet (2 sider)', no: 'Dobbeltsidig (2 sider)' } }
    ]
  },
  {
    id: 'num_pages',
    code: '2.1',
    name: 'Number of Pages',
    nameI18n: { sv: 'Antal sidor', da: 'Antal sider', no: 'Antall sider' },
    group: 'online_design',
    enabled: true,
    options: [
      { id: 'np-1', label: '1 Page', value: '1', priceModifier: 0, isDefault: true, labelI18n: { sv: '1 sida', da: '1 side', no: '1 side' } },
      { id: 'np-2', label: '2 Pages', value: '2', priceModifier: 15, labelI18n: { sv: '2 sidor', da: '2 sider', no: '2 sider' } },
      { id: 'np-3', label: '4 Pages', value: '4', priceModifier: 30, labelI18n: { sv: '4 sidor', da: '4 sider', no: '4 sider' } },
      { id: 'np-4', label: '8 Pages', value: '8', priceModifier: 60, labelI18n: { sv: '8 sidor', da: '8 sider', no: '8 sider' } }
    ]
  },
  {
    id: 'side_list',
    code: '2.2',
    name: 'Side list',
    nameI18n: { sv: 'Sidlista', da: 'Sideliste', no: 'Sideliste' },
    group: 'online_design',
    enabled: true,
    options: [
      { id: 'sl-1', label: 'Front Side Only', value: 'front', priceModifier: 0, isDefault: true, labelI18n: { sv: 'Endast framsida', da: 'Kun forside', no: 'Bare forside' } },
      { id: 'sl-2', label: 'Back Side Only', value: 'back', priceModifier: 0, labelI18n: { sv: 'Endast baksida', da: 'Kun bagside', no: 'Bare bakside' } },
      { id: 'sl-3', label: 'Both Sides', value: 'both', priceModifier: 35, labelI18n: { sv: 'Båda sidor', da: 'Begge sider', no: 'Begge sider' } }
    ]
  },
  {
    id: 'front_back_sides',
    code: '2.3',
    name: 'Front/Back Sides',
    nameI18n: { sv: 'Fram-/baksida', da: 'For-/bagside', no: 'For-/bakside' },
    group: 'online_design',
    enabled: true,
    options: [
      { id: 'fbs-1', label: '4/0 - Color Front / Blank Back', value: '4_0', priceModifier: 0, isDefault: true, labelI18n: { sv: '4/0 - Färg framsida / otryckt baksida', da: '4/0 - Farve forside / utrykt bagside', no: '4/0 - Farge forside / utrykt bakside' } },
      { id: 'fbs-2', label: '4/1 - Color Front / B&W Back', value: '4_1', priceModifier: 20, labelI18n: { sv: '4/1 - Färg framsida / svartvit baksida', da: '4/1 - Farve forside / sort-hvid bagside', no: '4/1 - Farge forside / sort-hvit bakside' } },
      { id: 'fbs-3', label: '4/4 - Color Both Sides', value: '4_4', priceModifier: 45, labelI18n: { sv: '4/4 - Färg på båda sidor', da: '4/4 - Farve på begge sider', no: '4/4 - Farge på begge sider' } }
    ]
  },
  {
    id: 'color_material',
    code: '3',
    name: 'Color/Material',
    nameI18n: { sv: 'Färg/material', da: 'Farve/materiale', no: 'Farge/materiale' },
    group: 'online_design',
    enabled: true,
    options: [
      { id: 'cm-1', label: '350 GSM Silk Cardstock', value: 'silk_350', priceModifier: 0, isDefault: true, labelI18n: { sv: '350 GSM silkeskartong', da: '350 GSM silkekarton', no: '350 GSM silkekartong' } },
      { id: 'cm-2', label: '300 GSM Uncoated Recycled', value: 'uncoated_300', priceModifier: 15, labelI18n: { sv: '300 GSM obestruket returpapper', da: '300 GSM ubestrøget genbrugspapir', no: '300 GSM ubestrøket resirkulert papir' } },
      { id: 'cm-3', label: '400 GSM Heavy Gloss Paper', value: 'gloss_400', priceModifier: 25, labelI18n: { sv: '400 GSM kraftigt blankt papper', da: '400 GSM kraftigt blankt papir', no: '400 GSM kraftig blankt papir' } },
      { id: 'cm-4', label: 'Premium Kraft Brown Paper', value: 'kraft', priceModifier: 20, labelI18n: { sv: 'Premium brunt Kraft-papper', da: 'Premium brunt Kraft-papir', no: 'Premium brunt Kraft-papir' } },
      { id: 'cm-5', label: '510 GSM Weatherproof PVC Vinyl', value: 'pvc_510', priceModifier: 60, labelI18n: { sv: '510 GSM väderbeständig PVC-vinyl', da: '510 GSM vejrbestandig PVC-vinyl', no: '510 GSM værbestandig PVC-vinyl' } }
    ]
  },
  {
    id: 'size',
    code: '4',
    name: 'Size',
    nameI18n: { sv: 'Storlek', da: 'Størrelse', no: 'Størrelse' },
    group: 'online_design',
    enabled: true,
    options: [
      { id: 'sz-1', label: 'Standard Business Card (85x55 mm)', value: '85x55', priceModifier: 0, isDefault: true, labelI18n: { sv: 'Standard visitkort (85x55 mm)', da: 'Standard visitkort (85x55 mm)', no: 'Standard visittkort (85x55 mm)' } },
      { id: 'sz-2', label: 'A5 (148x210 mm)', value: 'A5', priceModifier: 25 },
      { id: 'sz-3', label: 'A4 (210x297 mm)', value: 'A4', priceModifier: 45 },
      { id: 'sz-4', label: 'A3 (297x420 mm)', value: 'A3', priceModifier: 85 },
      { id: 'sz-5', label: 'A2 Poster (420x594 mm)', value: 'A2', priceModifier: 140, labelI18n: { sv: 'A2 affisch (420x594 mm)', da: 'A2 plakat (420x594 mm)', no: 'A2 plakat (420x594 mm)' } }
    ]
  },
  {
    id: 'custom_dimension',
    code: '5',
    name: 'Custom dimension',
    nameI18n: { sv: 'Egna mått', da: 'Egne mål', no: 'Egne mål' },
    group: 'online_design',
    enabled: true,
    options: [
      { id: 'cd-1', label: 'Custom Width & Height Calculation', value: 'custom_calc', priceModifier: 0, isDefault: true, labelI18n: { sv: 'Beräkning av egen bredd och höjd', da: 'Beregning af egen bredde og højde', no: 'Beregning av egen bredde og høyde' } }
    ]
  },
  {
    id: 'dpi',
    code: '6',
    name: 'DPI',
    group: 'online_design',
    enabled: true,
    options: [
      { id: 'dpi-1', label: '150 DPI (Large Outdoor Banner)', value: '150', priceModifier: 0, labelI18n: { sv: '150 DPI (stor utomhusbanner)', da: '150 DPI (stort udendørsbanner)', no: '150 DPI (stort utendørsbanner)' } },
      { id: 'dpi-2', label: '300 DPI (High Resolution Standard)', value: '300', priceModifier: 0, isDefault: true, labelI18n: { sv: '300 DPI (standard högupplöst)', da: '300 DPI (standard høj opløsning)', no: '300 DPI (standard høy oppløsning)' } },
      { id: 'dpi-3', label: '600 DPI (Ultra Fine Detail)', value: '600', priceModifier: 25, labelI18n: { sv: '600 DPI (extra fina detaljer)', da: '600 DPI (ekstra fine detaljer)', no: '600 DPI (ekstra fine detaljer)' } }
    ]
  },
  {
    id: 'area_design_shape',
    code: '7',
    name: 'Area design shape',
    nameI18n: { sv: 'Form på designyta', da: 'Form på designflade', no: 'Form på designflate' },
    group: 'online_design',
    enabled: true,
    options: [
      { id: 'ads-1', label: 'Standard Rectangle / Square', value: 'rectangle', priceModifier: 0, isDefault: true, labelI18n: { sv: 'Standard rektangel/kvadrat', da: 'Standard rektangel/kvadrat', no: 'Standard rektangel/kvadrat' } },
      { id: 'ads-2', label: 'Circular / Round Cut', value: 'circle', priceModifier: 20, labelI18n: { sv: 'Cirkel / rund stansning', da: 'Cirkel / rund stansning', no: 'Sirkel / rund stansing' } },
      { id: 'ads-3', label: 'Oval Shape', value: 'oval', priceModifier: 20, labelI18n: { sv: 'Oval form', da: 'Oval form', no: 'Oval form' } },
      { id: 'ads-4', label: 'Custom Contour Die-Cut', value: 'custom_contour', priceModifier: 55, labelI18n: { sv: 'Egen konturstansning', da: 'Egen konturstansning', no: 'Egen konturstansing' } }
    ]
  },
  {
    id: 'custom_area_design_shape',
    code: '7.1',
    name: 'Custom area design shape',
    nameI18n: { sv: 'Egen form på designyta', da: 'Egen form på designflade', no: 'Egen form på designflate' },
    group: 'online_design',
    enabled: true,
    options: [
      { id: 'cads-1', label: 'Vector Path Die-Line Upload', value: 'vector_path', priceModifier: 40, isDefault: true, labelI18n: { sv: 'Uppladdning av stanslinje i vektor', da: 'Upload af stanselinje i vektor', no: 'Opplasting av stanselinje i vektor' } }
    ]
  },
  {
    id: 'orientation',
    code: '8',
    name: 'Orientation',
    nameI18n: { sv: 'Orientering', da: 'Orientering', no: 'Orientering' },
    group: 'online_design',
    enabled: true,
    options: [
      { id: 'ori-1', label: 'Portrait (Vertical)', value: 'portrait', priceModifier: 0, isDefault: true, labelI18n: { sv: 'Stående (vertikalt)', da: 'Stående (lodret)', no: 'Stående (loddrett)' } },
      { id: 'ori-2', label: 'Landscape (Horizontal)', value: 'landscape', priceModifier: 0, labelI18n: { sv: 'Liggande (horisontellt)', da: 'Liggende (vandret)', no: 'Liggende (vannrett)' } },
      { id: 'ori-3', label: 'Square', value: 'square', priceModifier: 0, labelI18n: { sv: 'Kvadratiskt', da: 'Kvadratisk', no: 'Kvadratisk' } }
    ]
  },
  {
    id: 'padding',
    code: '9',
    name: 'Padding',
    nameI18n: { sv: 'Marginal', da: 'Margen', no: 'Marg' },
    group: 'online_design',
    enabled: true,
    options: [
      { id: 'pad-1', label: '3mm Standard Bleed & Safe Margin', value: '3mm', priceModifier: 0, isDefault: true, labelI18n: { sv: '3mm standard utfall och skyddsmarginal', da: '3mm standard beskæring og sikkerhedsmargen', no: '3mm standard utfall og sikkerhetsmarg' } },
      { id: 'pad-2', label: '5mm Wide Safe Border', value: '5mm', priceModifier: 0, labelI18n: { sv: '5mm bred skyddszon', da: '5mm bred sikkerhedszone', no: '5mm bred sikkerhetssone' } }
    ]
  },
  {
    id: 'rounded_corners',
    code: '10',
    name: 'Rounded corners',
    nameI18n: { sv: 'Rundade hörn', da: 'Runde hjørner', no: 'Avrundede hjørner' },
    group: 'online_design',
    enabled: true,
    options: [
      { id: 'rc-1', label: 'Square Corners (No Rounding)', value: 'none', priceModifier: 0, isDefault: true, labelI18n: { sv: 'Raka hörn (ingen rundning)', da: 'Lige hjørner (ingen afrunding)', no: 'Rette hjørner (ingen avrunding)' } },
      { id: 'rc-2', label: '3mm Radius Corners', value: '3mm', priceModifier: 15, labelI18n: { sv: 'Hörn med 3mm radie', da: 'Hjørner med 3mm radius', no: 'Hjørner med 3mm radius' } },
      { id: 'rc-3', label: '6mm Radius Corners', value: '6mm', priceModifier: 20, labelI18n: { sv: 'Hörn med 6mm radie', da: 'Hjørner med 6mm radius', no: 'Hjørner med 6mm radius' } }
    ]
  },
  {
    id: 'overlay',
    code: '11',
    name: 'Overlay',
    nameI18n: { sv: 'Ytbehandling', da: 'Overfladebehandling', no: 'Overflatebehandling' },
    group: 'online_design',
    enabled: true,
    options: [
      { id: 'ov-1', label: 'None / Standard Finish', value: 'none', priceModifier: 0, isDefault: true, labelI18n: { sv: 'Ingen / standardyta', da: 'Ingen / standardoverflade', no: 'Ingen / standardoverflate' } },
      { id: 'ov-2', label: 'Spot UV Varnish (Gloss highlights)', value: 'spot_uv', priceModifier: 45, labelI18n: { sv: 'Partiell UV-lack (blanka detaljer)', da: 'Partiel UV-lak (blanke detaljer)', no: 'Partiell UV-lakk (blanke detaljer)' } },
      { id: 'ov-3', label: 'Gold Metallic Foil Stamping', value: 'gold_foil', priceModifier: 95, labelI18n: { sv: 'Guldfolieprägling', da: 'Guldfolieprægning', no: 'Gullfoliepreging' } },
      { id: 'ov-4', label: 'Silver Metallic Foil Stamping', value: 'silver_foil', priceModifier: 85, labelI18n: { sv: 'Silverfolieprägling', da: 'Sølvfolieprægning', no: 'Sølvfoliepreging' } },
      { id: 'ov-5', label: 'Velvet Soft Touch Lamination', value: 'soft_touch', priceModifier: 35, labelI18n: { sv: 'Sammetslen soft touch-laminering', da: 'Fløjlsblød soft touch-laminering', no: 'Fløyelsmyk soft touch-laminering' } }
    ]
  },
  {
    id: 'folding_styles',
    code: '12',
    name: 'Folding Styles',
    nameI18n: { sv: 'Vikningstyper', da: 'Falsningstyper', no: 'Falsingstyper' },
    group: 'online_design',
    enabled: true,
    options: [
      { id: 'fs-1', label: 'Flat (No Fold)', value: 'flat', priceModifier: 0, isDefault: true, labelI18n: { sv: 'Plan (ingen vikning)', da: 'Flad (ingen falsning)', no: 'Flat (ingen falsing)' } },
      { id: 'fs-2', label: 'Half Fold (Single Fold)', value: 'half', priceModifier: 15, labelI18n: { sv: 'Halvvikning (enkel vikning)', da: 'Halvfalsning (enkelt fals)', no: 'Halvfalsing (enkel fals)' } },
      { id: 'fs-3', label: 'Tri-Fold / C-Fold', value: 'tri_c', priceModifier: 25, labelI18n: { sv: 'Trevikning / C-vikning', da: 'Trefalsning / C-falsning', no: 'Trefalsing / C-falsing' } },
      { id: 'fs-4', label: 'Z-Fold (Accordion)', value: 'z_fold', priceModifier: 25, labelI18n: { sv: 'Z-vikning (dragspel)', da: 'Z-falsning (harmonika)', no: 'Z-falsing (trekkspill)' } },
      { id: 'fs-5', label: 'Gate Fold', value: 'gate', priceModifier: 35, labelI18n: { sv: 'Portvikning', da: 'Portfalsning', no: 'Portfalsing' } }
    ]
  },

  // Product builder fields
  {
    id: 'component',
    code: '20',
    name: 'Component',
    nameI18n: { sv: 'Komponent', da: 'Komponent', no: 'Komponent' },
    group: 'product_builder',
    enabled: true,
    options: [
      { id: 'comp-1', label: 'Standard Canvas Layout', value: 'standard_canvas', priceModifier: 0, isDefault: true, labelI18n: { sv: 'Standardlayout på arbetsyta', da: 'Standardlayout på arbejdsflade', no: 'Standardoppsett på arbeidsflate' } },
      { id: 'comp-2', label: 'Multi-layer Object Layers', value: 'multi_layer', priceModifier: 0, labelI18n: { sv: 'Flera objektlager', da: 'Flere objektlag', no: 'Flere objektlag' } }
    ]
  },
  {
    id: 'text',
    code: '21',
    name: 'Text',
    nameI18n: { da: 'Tekst', no: 'Tekst' },
    group: 'product_builder',
    enabled: true,
    options: [
      { id: 'txt-1', label: 'Custom Typography & Font Picker', value: 'enabled', priceModifier: 0, isDefault: true, labelI18n: { sv: 'Egen typografi och typsnittsväljare', da: 'Egen typografi og skrifttypevælger', no: 'Egen typografi og skriftvelger' } }
    ]
  },
  {
    id: 'image',
    code: '22',
    name: 'Image',
    nameI18n: { sv: 'Bild', da: 'Billede', no: 'Bilde' },
    group: 'product_builder',
    enabled: true,
    options: [
      { id: 'img-1', label: 'Image Upload & ClipArt Gallery', value: 'enabled', priceModifier: 0, isDefault: true, labelI18n: { sv: 'Bilduppladdning och clipart-galleri', da: 'Billedupload og clipart-galleri', no: 'Bildeopplasting og clipart-galleri' } }
    ]
  },

  // Upload design file & Custom Pricing fields
  {
    id: 'frame_styles',
    code: '40',
    name: 'Frame styles',
    nameI18n: { sv: 'Ramtyper', da: 'Rammetyper', no: 'Rammetyper' },
    group: 'upload_design',
    enabled: true,
    options: [
      { id: 'frm-1', label: 'No Frame (Borderless Cut)', value: 'none', priceModifier: 0, isDefault: true, labelI18n: { sv: 'Ingen ram (skuren utan kant)', da: 'Ingen ramme (skåret uden kant)', no: 'Ingen ramme (skåret uten kant)' } },
      { id: 'frm-2', label: 'Black Aluminum Frame', value: 'black_alum', priceModifier: 180, labelI18n: { sv: 'Svart aluminiumram', da: 'Sort aluminiumsramme', no: 'Svart aluminiumsramme' } },
      { id: 'frm-3', label: 'Natural Wood Stretch Frame', value: 'wood_stretch', priceModifier: 220, labelI18n: { sv: 'Spännram i obehandlat trä', da: 'Spændramme i ubehandlet træ', no: 'Spennramme i ubehandlet tre' } }
    ]
  },
  {
    id: 'num_upload_files',
    code: '41',
    name: 'Number of upload files',
    nameI18n: { sv: 'Antal uppladdade filer', da: 'Antal uploadede filer', no: 'Antall opplastede filer' },
    group: 'upload_design',
    enabled: true,
    options: [
      { id: 'nof-1', label: '1 Single PDF / Image File', value: '1', priceModifier: 0, isDefault: true, labelI18n: { sv: '1 enskild PDF-/bildfil', da: '1 enkelt PDF-/billedfil', no: '1 enkelt PDF-/bildefil' } },
      { id: 'nof-2', label: '2 Separate Files (Front & Back)', value: '2', priceModifier: 0, labelI18n: { sv: '2 separata filer (framsida och baksida)', da: '2 separate filer (forside og bagside)', no: '2 separate filer (forside og bakside)' } },
      { id: 'nof-3', label: 'Multiple Files (up to 10 artwork files)', value: 'multiple', priceModifier: 20, chargeOnce: true, labelI18n: { sv: 'Flera filer (upp till 10 original)', da: 'Flere filer (op til 10 trykfiler)', no: 'Flere filer (opptil 10 trykkfiler)' } }
    ]
  },
  {
    id: 'custom_file_upload_rules',
    code: '50',
    name: 'Custom File Upload & Dimension Calculator',
    nameI18n: { sv: 'Egen filuppladdning och måttkalkylator', da: 'Egen filupload og målberegner', no: 'Egen filopplasting og målkalkulator' },
    group: 'upload_design',
    enabled: true,
    options: [
      { id: 'cfu-1', label: 'Standard Dimensions Calculator', value: 'standard_calc', priceModifier: 0, isDefault: true, labelI18n: { sv: 'Standardkalkylator för mått', da: 'Standardberegner for mål', no: 'Standardkalkulator for mål' } },
      { id: 'cfu-2', label: 'Large Format Meter Calculator', value: 'large_format_calc', priceModifier: 0, labelI18n: { sv: 'Meterkalkylator för storformat', da: 'Meterberegner til storformat', no: 'Meterkalkulator for storformat' } }
    ]
  },
  {
    id: 'quantity_volume_discounts',
    code: '51',
    name: 'Quantity Volume Discounts',
    nameI18n: { sv: 'Mängdrabatter', da: 'Mængderabatter', no: 'Mengderabatter' },
    group: 'upload_design',
    enabled: true,
    options: [
      { id: 'qvd-1', label: 'Standard Tier Discounts (10+, 50+, 100+)', value: 'tier_standard', priceModifier: 0, isDefault: true, labelI18n: { sv: 'Standardrabatter i nivåer (10+, 50+, 100+)', da: 'Standardrabatter i trin (10+, 50+, 100+)', no: 'Standardrabatter i trinn (10+, 50+, 100+)' } },
      { id: 'qvd-2', label: 'Wholesale Bulk Discount', value: 'wholesale', priceModifier: 0, labelI18n: { sv: 'Grossistrabatt', da: 'Engrosrabat', no: 'Engrosrabatt' } }
    ]
  }
];

/** Starting catalogue offered by the dashboard, before the owner edits it. */
export const INITIAL_PRINTING_FIELDS: PrintingField[] = [
  ...LEGACY_PRINTING_FIELDS,
  ...OPTION_CATALOGUE
];

export default function PrintingFieldsAdmin() {
  const { user, t } = useAuth();
  // In-page dialogs, never window.confirm/alert — a browser that has been told
  // to stop prompting silences those, and the action then does nothing at all.
  const { confirm, notify, dialog: confirmDialog } = useConfirmDialog();

  const [fields, setFields] = useState<PrintingField[]>(INITIAL_PRINTING_FIELDS);
  const [savingLibrary, setSavingLibrary] = useState(false);
  const [librarySaved, setLibrarySaved] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [appliedCount, setAppliedCount] = useState(0);

  // New Printing Field Creation State
  const [isCreatingField, setIsCreatingField] = useState(false);
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldCode, setNewFieldCode] = useState('');
  const [newFieldGroup, setNewFieldGroup] = useState<PrintingFieldGroupType>('online_design');
  const [initialOptionLabel, setInitialOptionLabel] = useState('');
  const [initialOptionPrice, setInitialOptionPrice] = useState<number>(0);

  // Apply target mode: 'products' | 'categories'
  const [applyTarget, setApplyTarget] = useState<'products' | 'categories'>('products');
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Selected Printing Field for Editing Options Modal
  /**
   * WHICH property is open — its id, never a copy of it.
   *
   * The panel used to hold its own copy of the property next to the library's
   * (`fields`), and every edit ran one updater against both. React may run those
   * two updaters at different moments, so "Add option" — which mints an id from
   * the clock — could give the panel's new option one id and the library's
   * another. Everything typed into that option then went to an id the library
   * did not have, and Save stored a blank option. One store, read here, cannot
   * disagree with itself.
   */
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  // The properties changed in this visit. Pre-ticked when he chooses "update
  // the chosen properties", because they are almost always the ones he means.
  const [editedFieldIds, setEditedFieldIds] = useState<string[]>([]);

  // The Update & apply dialog — HOW the library reaches the products is his
  // choice every time (src/lib/libraryApply.ts). 'add-new' is the default
  // because it is the one that cannot take anything away.
  const [applyDialogOpen, setApplyDialogOpen] = useState(false);
  const [applyMode, setApplyMode] = useState<LibraryApplyMode>('add-new');
  const [applyFieldIds, setApplyFieldIds] = useState<string[]>([]);
  const [applyDropProductOnly, setApplyDropProductOnly] = useState(false);
  // update-selected only: keep each product's on/off, or switch the chosen
  // properties on / off on every target product (show or hide in bulk).
  const [applySwitch, setApplySwitch] = useState<'keep' | 'on' | 'off'>('keep');
  const [applyFieldSearch, setApplyFieldSearch] = useState('');

  /**
   * THE PRICING EDITOR, SEEDED FROM THE SHOP'S OWN DEFAULTS AND NEVER FROM A
   * PRODUCT.
   *
   * These four numbers and the tier list used to be filled in from `pList[0]` —
   * whichever product Firestore happened to hand back first. A hand-added
   * product (id `prod-${Date.now()}`) sorts ahead of every `prod-pmp-*` from the
   * supplier feed, so the boxes quietly loaded one arbitrary product's money and
   * pressing Update copied it onto every product ticked in the sidebar. A 40 kr
   * door sign came back carrying a 149 kr floor and a 49 kr setup fee, and
   * because the floor lands on the UNIT price before the quantity multiply, 100
   * of them billed 10 449 kr where the product's own price and the same volume
   * tier would have billed 2 849. The same move in the other direction zeroed a
   * hand-added product's floor and fee just as silently. Nobody was ever shown a
   * number they had chosen.
   *
   * Note what the incident was and was NOT. The old panel's defaults happened to
   * be the same numbers as PRICING_DEFAULTS, so writing them onto a product that
   * had no rules of its own changed nothing — the floor was already reaching it
   * through the fallback. The damage was in the OTHER direction and in the
   * carry-over: values the owner had set on one product being copied onto every
   * other, and a hand-added product's deliberate floor and fee being flattened
   * to whatever the editor happened to be showing.
   *
   * PRICING_DEFAULTS (src/lib/pricing.ts) is what the shop already falls back to
   * when a product carries no rules of its own, in the browser and on the server
   * alike. Seeding from it means the boxes open on values the owner can
   * recognise, belonging to no product in particular, carrying nothing invisibly
   * from one product to another.
   */
  const [customUploadConfig, setCustomUploadConfig] = useState<Pick<CustomUploadRules, 'minPrice' | 'pricePerSqm' | 'pricePerLinearMeter'>>({
    minPrice: PRICING_DEFAULTS.minPrice,
    pricePerSqm: PRICING_DEFAULTS.pricePerSqm,
    pricePerLinearMeter: PRICING_DEFAULTS.pricePerLinearMeter,
  });

  const [pricingConfig, setPricingConfig] = useState<Pick<PricingRules, 'baseSetupFee' | 'volumeDiscounts'>>({
    baseSetupFee: PRICING_DEFAULTS.baseSetupFee,
    // Copied rather than referenced: PRICING_DEFAULTS is declared `as const`, and
    // the tier editor below adds to and removes from this array.
    volumeDiscounts: PRICING_DEFAULTS.volumeDiscounts.map((tier) => ({ ...tier })),
  });

  /**
   * THE GATE, and the whole point of this panel's return.
   *
   * Off, and Update writes `printingFields` and nothing else — which is what the
   * screen was reduced to after the incident above. On, and the prices in this
   * panel are written too. It is deliberately a separate act from pressing
   * Update: it starts off on every page load, it is never remembered between
   * loads, it goes back off after a successful write, and its label counts the
   * products it is about to re-price. Options and money are two different
   * decisions, so they need two different clicks.
   */
  const [applyPricing, setApplyPricing] = useState(false);

  const [newTierQty, setNewTierQty] = useState<number>(20);
  const [newTierDiscount, setNewTierDiscount] = useState<number>(15);

  const handleAddVolumeTier = () => {
    if (newTierQty <= 0 || newTierDiscount <= 0) return;
    const currentTiers = pricingConfig.volumeDiscounts || [];
    const updated = [...currentTiers, { minQuantity: newTierQty, discountPercentage: newTierDiscount }]
      .sort((a, b) => a.minQuantity - b.minQuantity);
    setPricingConfig({ ...pricingConfig, volumeDiscounts: updated });
  };

  const handleRemoveVolumeTier = (index: number) => {
    const currentTiers = pricingConfig.volumeDiscounts || [];
    const updated = currentTiers.filter((_, i) => i !== index);
    setPricingConfig({ ...pricingConfig, volumeDiscounts: updated });
  };

  const handleCreateField = () => {
    if (!newFieldName.trim()) return;

    const newField: PrintingField = {
      id: `custom_field_${Date.now()}`,
      code: newFieldCode.trim() || `${fields.length + 1}`,
      name: newFieldName.trim(),
      group: newFieldGroup,
      enabled: true,
      options: initialOptionLabel.trim() ? [
        {
          id: `opt-${Date.now()}`,
          label: initialOptionLabel.trim(),
          value: initialOptionLabel.trim().toLowerCase().replace(/\s+/g, '_'),
          priceModifier: Number(initialOptionPrice) || 0,
          isDefault: true
        }
      ] : []
    };

    setFields(prev => [...prev, newField]);
    setIsCreatingField(false);
    setNewFieldName('');
    setNewFieldCode('');
    setInitialOptionLabel('');
    setInitialOptionPrice(0);
  };

  const handleDeleteField = async (fieldId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (await confirm({ title: t('pfConfirmRemove'), confirmLabel: t('dlgConfirm') })) {
      setFields(prev => prev.filter(f => f.id !== fieldId));
      if (editingFieldId === fieldId) {
        setEditingFieldId(null);
      }
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const libSnap = await getDoc(doc(db, 'settings', OPTION_LIBRARY_DOC));
      const savedLibrary = libSnap.exists() ? (libSnap.data()?.fields as PrintingField[] | undefined) : undefined;
      if (savedLibrary && savedLibrary.length > 0) {
        setFields(savedLibrary);
      }

      const pSnap = await getDocs(collection(db, 'products'));
      const pList = pSnap.docs.map(d => ({ id: d.id, ...d.data() } as Product));
      setProducts(pList);

      const cSnap = await getDocs(collection(db, 'categories'));
      const cList = cSnap.docs.map(d => ({ id: d.id, ...d.data() } as Category));
      setCategories(cList);

      // NOTHING is pre-selected. This used to tick whichever product Firestore
      // listed first — an arbitrary product as the apply target — and ticking a
      // product loaded ITS properties into this editor (see
      // handleToggleSelectProduct), so a plain "Save" could write one product's
      // configuration over the whole shared library.
    } catch (err) {
      console.warn('Error fetching products/categories for printing fields:', err);
    } finally {
      setLoading(false);
    }
  };

  // Persist the field catalogue itself. Without this the editor was memory-only:
  // every added, renamed or deleted field came back on the next page load.
  const handleSaveLibrary = async () => {
    // AN OPTION WITHOUT A NAME is an empty card on every product the library
    // reaches. "Add option" starts a blank row (the old add form demanded a
    // label first), so it is checked here, where it would otherwise spread.
    const blankIn = new Set<string>();
    const scan = (list: PrintingField[] | undefined, owner?: string) => {
      for (const f of list ?? []) {
        for (const o of f.options ?? []) {
          if (!String(o.label ?? '').trim()) blankIn.add(owner ?? f.name);
          scan(o.subFields, owner ?? f.name);
        }
      }
    };
    scan(fields);
    if (blankIn.size > 0) {
      void notify({
        title: 'An option has no name',
        message: `Give it a name or delete it, then save: ${[...blankIn].slice(0, 5).join(', ')}${blankIn.size > 5 ? '…' : ''}`,
        tone: 'primary',
      });
      return;
    }

    setSavingLibrary(true);
    try {
      const payload = { fields, updatedAt: new Date().toISOString() };

      // Firestore caps ONE document at 1 MiB and rejects the whole write when it
      // is exceeded — which would throw away every edit made in this screen, with
      // an error that says nothing about why. The library is already ~440 KB of
      // JSON at the shipped catalogue, so check before writing and name the
      // culprit: an inline base64 image is the only thing big enough to matter.
      const bytes = new TextEncoder().encode(JSON.stringify(payload)).length;
      const LIMIT = 900_000;
      if (bytes > LIMIT) {
        const heavy = fields
          .flatMap((f) => (f.options ?? []).map((o) => ({ field: f.name, option: o.label, url: o.imageUrl ?? '' })))
          .filter((o) => o.url.startsWith('data:'))
          .slice(0, 5)
          .map((o) => `${o.field} → ${o.option}`);
        alert(
          `The option library is ${Math.round(bytes / 1024)} KB and cannot be saved — one document may hold about 1000 KB.\n\n` +
            (heavy.length
              ? `Embedded images are the likely cause:\n${heavy.join('\n')}\n\nReplace them with uploaded images or links and try again.`
              : 'Remove some options or shorten their descriptions and try again.'),
        );
        return;
      }

      // Deep: an outline or a display choice set back to "automatic" is an
      // undefined somewhere inside a property, and Firestore refuses the lot.
      await setDoc(doc(db, 'settings', OPTION_LIBRARY_DOC), withoutUndefined(payload));
      setLibrarySaved(true);
      setTimeout(() => setLibrarySaved(false), 3000);
    } catch (err: any) {
      console.error('Error saving the option library to Firestore:', err);
      // The generic message hid permission errors and size rejections alike.
      alert(`Error saving the option library.\n\n${String(err?.message ?? err).slice(0, 300)}`);
    } finally {
      setSavingLibrary(false);
    }
  };

  const toggleFieldEnabled = (fieldId: string) => {
    setFields(prev => prev.map(f => {
      if (f.id === fieldId) {
        return { ...f, enabled: !f.enabled };
      }
      return f;
    }));
  };

  /**
   * Ticking a product chooses WHERE the library goes. Nothing else.
   *
   * It used to also load that product's own properties into this editor, merged
   * with the BUILT-IN catalogue rather than the saved library. The screen then
   * showed one product's configuration where the library should be, and "Save
   * option library" wrote it over the shared library for every product. Editing
   * one product's properties belongs to the product dialog.
   */
  const handleToggleSelectProduct = (productId: string) => {
    setSelectedProductIds((prev) =>
      prev.includes(productId) ? prev.filter((id) => id !== productId) : [...prev, productId],
    );
  };

  const handleToggleSelectCategory = (catId: string) => {
    if (selectedCategoryIds.includes(catId)) {
      setSelectedCategoryIds(selectedCategoryIds.filter(id => id !== catId));
    } else {
      setSelectedCategoryIds([...selectedCategoryIds, catId]);
    }
  };

  /**
   * What actually gets stored on one product: everything switched on, plus
   * anything it already carried so edits to a temporarily-off field are not
   * thrown away. The rest of the catalogue is deliberately left out — the
   * storefront downloads whole product documents, and writing all 176 fields
   * to each one measured 3 seconds slower on the shop page for every customer.
   */
  // fieldsForProduct() used to live here: it decided, per product, which fields
  // to write — the enabled ones plus any the product already carried. That rule
  // is unchanged, but it now runs on the SERVER, inside the same request that
  // does the write, because it needs each product's current fields and reading
  // them one at a time from the browser is what made this screen take six
  // seconds for two products. See /api/admin/products/bulk, op 'printingFields'.

  /**
   * Exactly the products an Update would write to, in either mode.
   *
   * Pulled out of handleUpdateAndApply so the pricing checkbox can put a real
   * number in its label. The count and the write loop now read the SAME list,
   * which is the only way the number can never lie: change the selection, or
   * flip between Products and Categories, and the label moves with it.
   */
  const targetProductIds = useMemo(() => {
    if (applyTarget === 'products') {
      // An empty selection means "every product" — the sidebar says so, and
      // handleUpdateAndApply asks for confirmation before writing that many.
      return selectedProductIds.length > 0 ? selectedProductIds : products.map(p => p.id);
    }
    // A product's categoryId holds either the category's id or its NAME — both
    // forms exist in the data — so match against both.
    const selectedCategoryNames = categories
      .filter(c => selectedCategoryIds.includes(c.id))
      .map(c => c.name);
    return products
      .filter(p => selectedCategoryIds.includes(p.categoryId) || selectedCategoryNames.includes(p.categoryId))
      .map(p => p.id);
  }, [applyTarget, selectedProductIds, selectedCategoryIds, products, categories]);

  /**
   * THE PRICING HALF OF THE WRITE, and why it is sent as `null` rather than as
   * zeroes when the box is unticked.
   *
   * With the box off, the request carries `pricing: null` and the server never
   * mentions `pricingRules` or `customUploadRules` at all — so a product's money
   * cannot be touched from this screen even by accident. That is the property
   * the audit wanted, and it is worth more than any warning text: the unsafe
   * write does not exist rather than being discouraged.
   *
   * When it IS ticked, the server overwrites only the keys this panel edits and
   * spreads each product's stored rules underneath them. customUploadRules is
   * two things wearing one name — the artwork rules the product editor owns
   * (`areaPriced`, allowed formats, max file size) and the per-square-metre
   * pricing the configurator and the server both read — so rebuilding the object
   * from this panel alone would switch area pricing off across a whole category
   * while the owner thought he was setting a discount. That is the same bug as
   * the one that got this panel deleted once, pointed at a different field.
   *
   * Both this merge and the per-product field rule now run inside
   * /api/admin/products/bulk (op 'printingFields'), because both need each
   * product's stored values and reading those one at a time from the browser is
   * what made this screen take six seconds for two products.
   */

  /**
   * Writes `printingFields` to the chosen products ALWAYS, and the pricing
   * objects ONLY when the pricing box is ticked.
   *
   * It used to write customUploadRules and pricingRules on every run, from an
   * editor seeded by whichever product happened to sort first (see the state
   * above). Whatever that product's money happened to be was copied onto every
   * product ticked in the sidebar: a 149 kr floor and a 49 kr setup fee landing
   * on a 40 kr door sign bill 10 449 kr at quantity 100 where the product's own
   * price and the same volume tier bill 2 849, because the floor lands on the
   * UNIT price before the quantity multiply — and the same move in reverse
   * flattened a hand-added product's deliberate floor to nothing. Nothing warned
   * about it: the one confirm dialog fires only when no product is selected, and
   * it talks about printing options.
   *
   * Taking pricing away altogether was the first fix and it went too far: volume
   * discounts are how a print shop sells, and after it nothing in the dashboard
   * could edit them at all. So pricing is back, but writing it is a separate,
   * deliberate act — an off-by-default tick, a label that counts the products it
   * would re-price, and a confirm that names that count again at the moment the
   * button is pressed.
   */
  /**
   * THE UPDATE BUTTON OPENS A QUESTION: HOW?
   *
   * It used to confirm "this overwrites the order" and then replace every target
   * product's properties with the library's — his per-product order, prices and
   * on/off gone, and the properties a product had of its own deleted. Now he
   * chooses each time (src/lib/libraryApply.ts), and the choice that cannot take
   * anything away is the one already selected.
   */
  const openApplyDialog = () => {
    // EVERY time back to the choice that cannot take anything away — a
    // "replace everything" used once must not be waiting, pre-selected, the
    // next time he only wants to push one price.
    setApplyMode('add-new');
    setApplySwitch('keep');
    setApplyFieldIds(editedFieldIds.filter((id) => fields.some((f) => f.id === id)));
    setApplyFieldSearch('');
    setApplyDropProductOnly(false);
    setApplyError(null);
    setApplyDialogOpen(true);
  };

  const handleUpdateAndApply = async () => {
    if (applyMode === 'update-selected' && applyFieldIds.length === 0) return;

    // Guard against silently overwriting EVERY product. Applying with no product
    // selected used to write to all products with no warning.
    if (applyTarget === 'products') {
      if (selectedProductIds.length === 0) {
        const ok = await confirm({
          title: t('pfApplyAllConfirm').replace('{0}', String(products.length)),
          confirmLabel: t('dlgConfirm'),
          tone: 'primary',
        });
        if (!ok) return;
      }
    } else {
      if (selectedCategoryIds.length === 0) {
        alert(t('pfPickCategory'));
        return;
      }
    }

    // Money gets its own question, in the danger tone, with the count spelled out
    // a second time. The tick may have been made several minutes and one changed
    // selection ago; this is the last moment the real number can be shown.
    if (applyPricing) {
      const ok = await confirm({
        title: t('pfPricingConfirm').replace('{0}', String(targetProductIds.length)),
        confirmLabel: t('dlgConfirm'),
      });
      if (!ok) return;
    }

    setSaving(true);
    setApplyError(null);
    try {
      // ONE REQUEST, not one per product.
      //
      // This used to be `for (const pid of targetProductIds) await updateDoc(…)`
      // — a serial browser loop. Task 0.2 timed it at SIX SECONDS for TWO
      // products, with nothing on screen while it ran and no way to resume if
      // the tab was closed halfway. A category of 500 is minutes of a screen
      // that looks idle and then, if the connection drops, half-written with no
      // record of which half.
      //
      // The server does it in batches of 400 and answers with a count. The rule
      // that a field the product already carries survives even when it is
      // switched off in the library moved there with it — the server reads each
      // product's current fields to apply it, which is the only per-product part
      // of this write.
      const result = await bulkProducts({
        ids: targetProductIds,
        op: 'printingFields',
        fields,
        mode: applyMode,
        ...(applyMode === 'update-selected'
          ? { fieldIds: applyFieldIds, ...(applySwitch !== 'keep' ? { switchTo: applySwitch } : {}) }
          : {}),
        ...(applyMode === 'replace-all' ? { dropProductOnly: applyDropProductOnly } : {}),
        pricing: applyPricing ? {
          minPrice: Number(customUploadConfig.minPrice) || 0,
          pricePerSqm: Number(customUploadConfig.pricePerSqm) || 0,
          pricePerLinearMeter: Number(customUploadConfig.pricePerLinearMeter) || 0,
          baseSetupFee: Number(pricingConfig.baseSetupFee) || 0,
          volumeDiscounts: pricingConfig.volumeDiscounts || [],
        } : null,
      });

      // The number the SERVER wrote, not the number we asked for. A product
      // deleted from another screen while this one was open is the difference,
      // and reporting the request count would quietly overstate the work.
      setAppliedCount(result.changed);
      setSaveSuccess(true);
      setApplyDialogOpen(false);
      // What has now reached the products is no longer "changed in this visit":
      // the properties pushed in update mode, or everything after a replace.
      if (applyMode === 'update-selected') {
        setEditedFieldIds((prev) => prev.filter((id) => !applyFieldIds.includes(id)));
      } else if (applyMode === 'replace-all') {
        setEditedFieldIds([]);
      }
      // Back to off. Leaving it ticked would re-price again on the next Update,
      // against whatever selection is on screen by then — and that next Update is
      // usually somebody adding one option to one product.
      setApplyPricing(false);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      console.error('Error applying printing fields:', err);
      // On screen, not in an alert() that says nothing about what went wrong and
      // is gone the moment it is dismissed.
      setApplyError(err?.message || t('pfApplyFailed'));
    } finally {
      setSaving(false);
    }
  };

  /**
   * THE LIBRARY EDITOR IS THE PRODUCT EDITOR NOW.
   *
   * This screen had its own, weaker editor: the English property name and an
   * existing option's label and price were read-only (changing a price meant
   * deleting the option and adding it again, which gave it a new id and broke
   * every basket that held it), and required, custom size and the questions
   * inside an option could not be set here at all. It renders the same
   * PrintingFieldEditorBody the product dialog uses, so the two can never drift.
   *
   * Every change goes through ONE updater applied to both stores — the open
   * panel (`editingField`) and the library (`fields`) — so they cannot disagree.
   */
  const updateEditingField = (updater: (field: PrintingField) => PrintingField) => {
    const id = editingFieldId;
    if (!id) return;
    setFields((prev) => prev.map((f) => (f.id === id ? updater(f) : f)));
    setEditedFieldIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  };

  /**
   * NULLS ARE STRIPPED ON THE WAY IN. The shared language control writes an
   * explicit null for a cleared box, which the screens that save with
   * { merge: true } need. This one replaces the whole library document, so an
   * absent key IS the deletion, and the nulls would only make a document that
   * is already ~440 KB of Firestore's 1 MB bigger.
   */
  const withoutNulls = (map: LocalizedText | undefined): LocalizedText | undefined => {
    const next: LocalizedText = {};
    for (const [lang, text] of Object.entries(map ?? {})) {
      if (typeof text === 'string' && text.trim()) next[lang as ShopLanguage] = text;
    }
    return Object.keys(next).length > 0 ? next : undefined;
  };

  const slugValue = (label: string) =>
    String(label || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'option';

  const handleLibraryFieldPatch = (patch: FieldPatch) =>
    updateEditingField((f) => {
      const updated: PrintingField = { ...f, ...patch };
      for (const key of ['nameI18n', 'descriptionI18n'] as const) {
        const cleaned = withoutNulls(updated[key]);
        if (cleaned) updated[key] = cleaned;
        else delete updated[key];
      }
      if (!updated.description) delete updated.description;
      if (!updated.required) delete updated.required;
      if (!updated.allowCustomSize) delete updated.allowCustomSize;
      for (const key of ['minWidthCm', 'maxWidthCm', 'minHeightCm', 'maxHeightCm'] as const) {
        const n = updated[key];
        if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) delete updated[key];
      }
      return updated;
    });

  const handleLibraryAddOption = () =>
    updateEditingField((f) => ({
      ...f,
      options: [
        ...f.options,
        {
          id: `opt-${Date.now()}`,
          label: '',
          value: '',
          priceModifier: 0,
          ...(f.options.length === 0 ? { isDefault: true } : {}),
        },
      ],
    }));

  const handleLibraryOptionPatch = (optionId: string, patch: OptionPatch) =>
    updateEditingField((f) => ({
      ...f,
      options: f.options.map((o) => {
        if (o.id !== optionId) return o;
        const updated: PrintingFieldOption = { ...o, ...patch };
        // `value` follows the label only while it is still the label's slug —
        // a curated value ('colour_navy_blue') is what the colour swatches read.
        if (patch.label !== undefined && (!o.value || o.value === slugValue(o.label))) {
          updated.value = slugValue(patch.label);
        }
        const labels = withoutNulls(updated.labelI18n);
        if (labels) updated.labelI18n = labels;
        else delete updated.labelI18n;
        if (!updated.dimensions) delete updated.dimensions;
        if (!updated.recommended) delete updated.recommended;
        if (!updated.imageUrl) delete updated.imageUrl;
        return updated;
      }),
    }));

  const handleLibrarySetDefault = (optionId: string) =>
    updateEditingField((f) => ({
      ...f,
      options: f.options.map((o) => {
        const updated: PrintingFieldOption = { ...o };
        if (o.id === optionId) updated.isDefault = true;
        else delete updated.isDefault;
        return updated;
      }),
    }));

  const handleLibraryRemoveOption = (optionId: string) =>
    updateEditingField((f) => ({ ...f, options: f.options.filter((o) => o.id !== optionId) }));

  /** One step up or down — the arrows. keepOwnerOrder: see PrintingField. */
  const handleLibraryMoveOption = (optionId: string, direction: -1 | 1) =>
    updateEditingField((f) => {
      const from = f.options.findIndex((o) => o.id === optionId);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= f.options.length) return f;
      const options = [...f.options];
      [options[from], options[to]] = [options[to], options[from]];
      return { ...f, options, keepOwnerOrder: true };
    });

  /** Anywhere — the drag. */
  const handleLibraryReorderOptions = (orderedIds: string[]) =>
    updateEditingField((f) => ({ ...f, options: reorderById(f.options, orderedIds), keepOwnerOrder: true }));

  /**
   * DRAG A PROPERTY WITHIN ITS GROUP BOX.
   *
   * The library's array order is the order "Update & apply" gives a product
   * that takes the library's order, and the order new products start from. The
   * four boxes are only a view of that one array, so a drag inside a box deals
   * that group's properties into the same slots in the new order — every other
   * property, in every other box, stays exactly where it was.
   */
  const handleReorderGroup = (group: PrintingFieldGroupType, orderedIds: string[]) => {
    setFields((prev) => reorderSubset(prev, (f) => f.group === group, orderedIds));
  };

  /** The open property, read from the one store (see editingFieldId). */
  const editingField = editingFieldId ? fields.find((f) => f.id === editingFieldId) ?? null : null;

  // Grouped Fields
  const defaultFields = fields.filter(f => f.group === 'default');
  const onlineDesignFields = fields.filter(f => f.group === 'online_design');
  const productBuilderFields = fields.filter(f => f.group === 'product_builder');
  const uploadDesignFields = fields.filter(f => f.group === 'upload_design');

  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    p.id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Admin & Staff access guard check
  if (!user || (user.role !== 'admin' && user.role !== 'staff')) {
    return (
      <div className="bg-red-50/90 border-2 border-red-200 rounded-3xl p-8 text-center max-w-2xl mx-auto my-12 space-y-4 shadow-xl animate-fade-in">
        <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-black text-gray-900">
          {t('pfDeniedTitle')}
        </h2>
        <p className="text-xs font-bold text-gray-600 leading-relaxed">
          {t('pfDeniedBody')}
        </p>
        <div className="inline-block bg-white px-4 py-1.5 rounded-xl border border-red-200 text-xs font-black text-red-700 shadow-2xs">
          {t('pfYourRole')}: {user?.role ? user.role.toUpperCase() : t('pfGuest')}
        </div>
      </div>
    );
  }

  // Until the SAVED library arrives, the built-in catalogue is what `fields`
  // holds — anything opened or edited in that moment would be overwritten by the
  // load a second later.
  if (loading) {
    return (
      <div className="bg-white rounded-3xl p-10 text-center text-xs font-bold text-gray-400 border border-gray-100">
        <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
        Loading the property library…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Banner / Notification */}
      {applyError && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-2xl text-xs font-bold">
          {applyError}
        </div>
      )}

      {saveSuccess && (
        <div className="bg-green-50 border border-green-200 text-green-800 p-4 rounded-2xl flex items-center justify-between shadow-sm animate-fade-in">
          <div className="flex items-center space-x-3 text-sm font-black">
            <Check className="w-5 h-5 text-green-600" />
            <span>{t('pfAppliedCount').replace('{0}', String(appliedCount))}</span>
          </div>
        </div>
      )}

      {/* Main Grid: Left Configurator (3/4) & Right "Apply for" Panel (1/4) */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
        {/* Left Section: Printing fields Containers */}
        <div className="lg:col-span-3 space-y-6 bg-white p-6 md:p-8 rounded-3xl border border-gray-100 shadow-sm">
          <div className="border-b border-gray-100 pb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center space-x-2">
                <Sliders className="w-5 h-5 text-blue-600" />
                <h2 className="text-xl font-black text-gray-900">Printing fields</h2>
                <span className="px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200 text-[0.625rem] font-black mr-2">
                  {t('pfBadge')}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {t('pfHint')}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setIsCreatingField(true)}
              className="px-4 py-2 bg-blue-600 text-white font-black text-xs rounded-xl hover:bg-blue-700 transition-all flex items-center space-x-1.5 shadow-sm active:scale-95"
            >
              <Plus className="w-4 h-4 ml-1" />
              <span>{t('pfAddField')}</span>
            </button>
          </div>

          {/* Tax System Notice */}
          <div className="bg-amber-50/70 border border-amber-200/80 rounded-2xl p-3.5 flex items-start space-x-3 text-amber-900 text-xs font-bold">
            <div className="p-1.5 bg-amber-100 rounded-lg shrink-0 mt-0.5">
              <span className="font-black text-amber-800 text-[0.6875rem]">25% VAT</span>
            </div>
            <div>
              <span className="font-extrabold text-amber-950 block">{t('pfVatNoteTitle')}</span>
              <p className="text-amber-800 font-semibold text-[0.6875rem] mt-0.5 leading-relaxed">
                    {t('pfVatNoteBefore')} <strong>{t('pfNetPrices')}</strong>. {t('pfVatNoteAfter')}
              </p>
            </div>
          </div>

          {/* The four groups — one array underneath, see handleReorderGroup. A
              property is dragged by its grip; a click on its name opens it. */}
          <p className="text-[0.6875rem] font-bold text-gray-500 -mb-2">
            Drag a property by its grip to change the order products receive it in.
          </p>
          {([
            ['default', 'Default field', defaultFields, 'bg-emerald-600'],
            ['online_design', 'Online design fields', onlineDesignFields, 'bg-emerald-600'],
            ['product_builder', 'Product builder fields', productBuilderFields, 'bg-emerald-600'],
            ['upload_design', 'Upload design file fields', uploadDesignFields, 'bg-indigo-600'],
          ] as const).map(([groupKey, title, list, codeBadge], groupIndex) => (
            <div
              key={groupKey}
              className={cn('relative border border-gray-200 rounded-2xl p-5 pt-7', groupIndex === 0 && 'mt-3')}
            >
              <div className="absolute -top-3.5 left-4 bg-white px-3 border border-gray-200 rounded-lg text-xs font-bold text-gray-700 shadow-2xs">
                {title}
              </div>

              <SortableList
                layout="grid"
                ids={list.map((f) => f.id)}
                onReorder={(orderedIds) => handleReorderGroup(groupKey, orderedIds)}
                className="flex flex-wrap gap-2.5"
                renderItem={(fieldId, { handle }) => {
                  const field = list.find((f) => f.id === fieldId);
                  if (!field) return null;
                  return (
                    <div
                      className={cn(
                        "group relative inline-flex items-center px-3 py-1.5 rounded-2xl text-xs font-bold transition-all border shadow-2xs hover:shadow-sm",
                        field.enabled
                          ? "bg-white border-gray-200 text-gray-800 hover:border-blue-400"
                          : "bg-gray-50 border-gray-200 text-gray-400 opacity-60"
                      )}
                    >
                      <DragHandle handle={handle} label={`Drag "${field.name}"`} className="p-0.5 -ml-1.5 mr-1" />
                      <button
                        type="button"
                        onClick={() => setEditingFieldId(field.id)}
                        className="flex items-center space-x-1.5 text-right"
                      >
                        <span>{field.name}</span>
                        {field.code && (
                          <span className={cn('px-1.5 py-0.5 rounded-full text-white font-black text-[0.625rem]', codeBadge)}>
                            {field.code}
                          </span>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={(e) => handleDeleteField(field.id, e)}
                        title={t('pfRemoveField')}
                        className="ml-2 text-gray-300 hover:text-red-600 p-0.5 rounded-full hover:bg-red-50 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                }}
              />
            </div>
          ))}

          {/* 5. Pricing rules panel.
              Restored after being deleted outright: with it gone, nothing in the
              whole dashboard could edit a volume discount or a minimum price, and
              a print shop sells on volume discounts. What made it dangerous was
              never the fields — it was that Update wrote them whether or not
              anyone had touched them, from values nobody had chosen. Both halves
              of that are fixed above: the boxes start from PRICING_DEFAULTS, and
              nothing here is written unless the tick below says so. */}
          <div className="border border-blue-200 rounded-3xl p-6 bg-linear-to-br from-blue-50/40 via-white to-purple-50/30 space-y-5 shadow-xs">
            <div className="flex items-center space-x-3 border-b border-blue-100 pb-4">
              <div className="p-2.5 bg-blue-600 text-white rounded-2xl shadow-md shadow-blue-500/20">
                <Calculator className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-black text-gray-900">
                  {t('pfPricingTitle')}
                </h3>
                <p className="text-xs text-gray-500 font-bold">
                  {t('pfPricingNote')}
                </p>
              </div>
            </div>

            {/* THE GATE.
                The count comes from targetProductIds — the very list the write
                loop iterates — so the label cannot promise one thing and the
                button do another. It moves with the sidebar selection, and it is
                honest about the worst case: with nothing ticked over there, the
                number it shows is every product in the shop. */}
            <label
              className={cn(
                "flex items-start space-x-3 p-4 rounded-2xl border cursor-pointer transition-colors",
                applyPricing
                  ? "bg-amber-50 border-amber-300 shadow-2xs"
                  : "bg-white border-gray-200 hover:border-gray-300"
              )}
            >
              <input
                type="checkbox"
                checked={applyPricing}
                onChange={(e) => setApplyPricing(e.target.checked)}
                className="w-4 h-4 mt-0.5 shrink-0 text-amber-600 rounded focus:ring-amber-500"
              />
              <span className="space-y-1">
                <span className={cn("block text-xs font-black", applyPricing ? "text-amber-900" : "text-gray-900")}>
                  {t('pfApplyPricingLabel').replace('{0}', String(targetProductIds.length))}
                </span>
                <span className={cn("block text-[0.6875rem] font-bold leading-relaxed", applyPricing ? "text-amber-800" : "text-gray-500")}>
                  {applyPricing ? t('pfApplyPricingOn') : t('pfApplyPricingOff')}
                </span>
              </span>
            </label>

            {/* Says out loud where these numbers came from. They are the shop's
                defaults, not the selected product's stored prices — the panel
                cannot show those, because it applies to many products at once and
                they do not agree with each other. */}
            <p className="flex items-start space-x-2 text-[0.6875rem] font-bold text-gray-500 leading-relaxed">
              <Info className="w-3.5 h-3.5 text-gray-400 shrink-0 mt-0.5" />
              <span>{t('pfPricingSeedNote')}</span>
            </p>

            {/* Pricing controls grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Min Base Price */}
              <div className="bg-white p-3.5 rounded-2xl border border-gray-200/80 shadow-2xs space-y-1">
                <label className="text-[0.6875rem] font-black text-gray-600 flex items-center space-x-1">
                  <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
                  <span>{t('pfMinPrice')}</span>
                </label>
                <div className="flex items-center">
                  <input
                    type="number"
                    value={customUploadConfig.minPrice}
                    onChange={(e) => setCustomUploadConfig({ ...customUploadConfig, minPrice: Number(e.target.value) })}
                    className="w-full text-sm font-black text-gray-900 bg-gray-50 px-3 py-1.5 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-xs font-bold text-gray-400 ml-2">SEK</span>
                </div>
              </div>

              {/* Price per Linear Meter */}
              <div className="bg-white p-3.5 rounded-2xl border border-gray-200/80 shadow-2xs space-y-1">
                <label className="text-[0.6875rem] font-black text-gray-600 flex items-center space-x-1">
                  <Ruler className="w-3.5 h-3.5 text-blue-600" />
                  <span>{t('pfPerLinearMeter')}</span>
                </label>
                <div className="flex items-center">
                  <input
                    type="number"
                    value={customUploadConfig.pricePerLinearMeter}
                    onChange={(e) => setCustomUploadConfig({ ...customUploadConfig, pricePerLinearMeter: Number(e.target.value) })}
                    className="w-full text-sm font-black text-gray-900 bg-gray-50 px-3 py-1.5 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-xs font-bold text-gray-400 ml-2">SEK/m</span>
                </div>
              </div>

              {/* Price per Sqm */}
              <div className="bg-white p-3.5 rounded-2xl border border-gray-200/80 shadow-2xs space-y-1">
                <label className="text-[0.6875rem] font-black text-gray-600 flex items-center space-x-1">
                  <Calculator className="w-3.5 h-3.5 text-purple-600" />
                  <span>{t('pfPerSqm')}</span>
                </label>
                <div className="flex items-center">
                  <input
                    type="number"
                    value={customUploadConfig.pricePerSqm}
                    onChange={(e) => setCustomUploadConfig({ ...customUploadConfig, pricePerSqm: Number(e.target.value) })}
                    className="w-full text-sm font-black text-gray-900 bg-gray-50 px-3 py-1.5 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-xs font-bold text-gray-400 ml-2">SEK/m²</span>
                </div>
              </div>

              {/* Base Setup Fee */}
              <div className="bg-white p-3.5 rounded-2xl border border-gray-200/80 shadow-2xs space-y-1">
                <label className="text-[0.6875rem] font-black text-gray-600 flex items-center space-x-1">
                  <Settings className="w-3.5 h-3.5 text-amber-600" />
                  <span>{t('pfSetupFee')}</span>
                </label>
                <div className="flex items-center">
                  <input
                    type="number"
                    value={pricingConfig.baseSetupFee}
                    onChange={(e) => setPricingConfig({ ...pricingConfig, baseSetupFee: Number(e.target.value) })}
                    className="w-full text-sm font-black text-gray-900 bg-gray-50 px-3 py-1.5 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-xs font-bold text-gray-400 ml-2">SEK</span>
                </div>
              </div>
            </div>

            {/* Volume Discounts Tier Configurator */}
            <div className="bg-white p-4 rounded-2xl border border-gray-200/80 space-y-3 shadow-2xs">
              <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                <div className="flex items-center space-x-2">
                  <Percent className="w-4 h-4 text-purple-600" />
                  <span className="text-xs font-black text-gray-900">
                    {t('pfVolumeTiers')}
                  </span>
                </div>
                <span className="text-[0.625rem] text-gray-400 font-bold">{t('pfTiersNote')}</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Tiers List */}
                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                  {(pricingConfig.volumeDiscounts || []).length === 0 ? (
                    <p className="text-xs text-gray-400 p-3 bg-gray-50 rounded-xl text-center">{t('pfNoTiers')}</p>
                  ) : (
                    pricingConfig.volumeDiscounts?.map((tier, idx) => (
                      <div key={idx} className="flex items-center justify-between p-2.5 bg-gray-50 rounded-xl border border-gray-200 text-xs font-bold">
                        <div className="flex items-center space-x-2">
                          <span className="text-gray-900">{t('pfFromQty').replace('{0}', String(tier.minQuantity))}</span>
                          <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full font-black text-[0.625rem]">
                            {tier.discountPercentage}% {t('pfOff')}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveVolumeTier(idx)}
                          className="text-red-400 hover:text-red-600 p-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>

                {/* Add Tier Form */}
                <div className="bg-purple-50/50 p-3 rounded-xl border border-purple-100 space-y-2">
                  <span className="block text-xs font-extrabold text-purple-900">{t('pfAddTier')}</span>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[0.625rem] font-bold text-gray-500 block mb-1">{t('pfMinQty')}</label>
                      <input
                        type="number"
                        value={newTierQty}
                        onChange={(e) => setNewTierQty(Number(e.target.value))}
                        className="w-full px-2.5 py-1 text-xs font-black bg-white border border-gray-200 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="text-[0.625rem] font-bold text-gray-500 block mb-1">{t('pfDiscountPct')}</label>
                      <input
                        type="number"
                        value={newTierDiscount}
                        onChange={(e) => setNewTierDiscount(Number(e.target.value))}
                        className="w-full px-2.5 py-1 text-xs font-black bg-white border border-gray-200 rounded-lg"
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddVolumeTier}
                    className="w-full py-1.5 bg-purple-600 text-white text-xs font-extrabold rounded-lg hover:bg-purple-700 transition-colors flex items-center justify-center space-x-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{t('pfAddDiscount')}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Section: "Apply for" Sidebar */}
        <div className="space-y-4">
          <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm space-y-5">
            {/* Action Top Bar */}
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <button
                type="button"
                onClick={async () => {
                  // One click used to swap his whole library on screen for the
                  // built-in catalogue — one Save away from replacing it.
                  const ok = await confirm({
                    title: 'Put the built-in catalogue on screen instead of your library?',
                    message:
                      'Every change you have not saved is thrown away. Your saved library stays as it is until you press Save — but "Update products…" would push what is on screen.',
                    confirmLabel: t('dlgConfirm'),
                  });
                  if (ok) {
                    setFields(INITIAL_PRINTING_FIELDS);
                    setEditingFieldId(null);
                    setEditedFieldIds([]);
                  }
                }}
                className="text-xs font-bold text-gray-400 hover:text-red-600 transition-colors"
              >
                Reset to Default
              </button>

              <button
                type="button"
                onClick={openApplyDialog}
                disabled={saving}
                className="bg-blue-600 text-white font-black text-xs px-5 py-2.5 rounded-xl hover:bg-blue-700 transition-all shadow-md shadow-blue-500/20 active:scale-95 disabled:opacity-50"
              >
                {saving ? 'Updating...' : 'Update products…'}
              </button>
            </div>

            {/* Save the catalogue itself, independently of applying it to products */}
            <button
              type="button"
              onClick={handleSaveLibrary}
              disabled={savingLibrary}
              className="w-full flex items-center justify-center gap-2 bg-gray-900 text-white font-black text-xs px-5 py-2.5 rounded-xl hover:bg-black transition-all active:scale-95 disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              {savingLibrary ? 'Saving library…' : librarySaved ? 'Library saved' : 'Save option library'}
            </button>
            <p className="text-[0.6875rem] font-bold text-gray-400 -mt-3">
              {savingLibrary
                ? 'Writing the whole catalogue — this takes a few seconds, please keep this page open.'
                : 'Stores your fields and values so they are here next time, and so the product editor offers them.'}
            </p>

            {/* Apply for selector */}
            <div className="space-y-3">
              <label className="block text-xs font-extrabold text-gray-900">
                Apply for
              </label>

              <div className="bg-gray-100 p-1 rounded-xl flex space-x-1">
                <button
                  type="button"
                  onClick={() => setApplyTarget('products')}
                  className={cn(
                    "flex-1 py-1.5 rounded-lg text-xs font-extrabold transition-all flex items-center justify-center space-x-1.5",
                    applyTarget === 'products'
                      ? "bg-blue-600 text-white shadow-sm"
                      : "text-gray-600 hover:text-gray-900"
                  )}
                >
                  <Package className="w-3.5 h-3.5" />
                  <span>Products</span>
                </button>

                <button
                  type="button"
                  onClick={() => setApplyTarget('categories')}
                  className={cn(
                    "flex-1 py-1.5 rounded-lg text-xs font-extrabold transition-all flex items-center justify-center space-x-1.5",
                    applyTarget === 'categories'
                      ? "bg-blue-600 text-white shadow-sm"
                      : "text-gray-600 hover:text-gray-900"
                  )}
                >
                  <Folder className="w-3.5 h-3.5" />
                  <span>Categories</span>
                </button>
              </div>
            </div>

            {/* Target Selection Picker */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-gray-700">
                {applyTarget === 'products' ? 'Select the Products to apply the options' : 'Select Categories to apply options'}
              </label>

              {/* Selected Pills */}
              <div className="min-h-[4.375rem] bg-gray-50 p-2.5 border border-gray-200 rounded-2xl flex flex-wrap gap-1.5">
                {applyTarget === 'products' ? (
                  selectedProductIds.length === 0 ? (
                    <span className="text-[0.6875rem] text-gray-400 p-1">All products selected by default.</span>
                  ) : (
                    selectedProductIds.map(id => {
                      const p = products.find(prod => prod.id === id);
                      return (
                        <span
                          key={id}
                          className="inline-flex items-center text-xs font-extrabold bg-blue-50 text-blue-700 px-2.5 py-1 rounded-xl border border-blue-200"
                        >
                          <span>{p ? p.name : id}</span>
                          <button
                            type="button"
                            onClick={() => handleToggleSelectProduct(id)}
                            className="ml-1 text-blue-400 hover:text-blue-800"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      );
                    })
                  )
                ) : (
                  selectedCategoryIds.length === 0 ? (
                    <span className="text-[0.6875rem] text-gray-400 p-1">Pick categories from list below.</span>
                  ) : (
                    selectedCategoryIds.map(id => {
                      const c = categories.find(cat => cat.id === id);
                      return (
                        <span
                          key={id}
                          className="inline-flex items-center text-xs font-extrabold bg-purple-50 text-purple-700 px-2.5 py-1 rounded-xl border border-purple-200"
                        >
                          <span>{c ? c.name : id}</span>
                          <button
                            type="button"
                            onClick={() => handleToggleSelectCategory(id)}
                            className="ml-1 text-purple-400 hover:text-purple-800"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      );
                    })
                  )
                )}
              </div>

              {/* Search & List */}
              <div className="space-y-1.5 pt-1">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Start typing a product or category..."
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-xl text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500"
                />

                <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                  {applyTarget === 'products' ? (
                    filteredProducts.map(p => {
                      const isSelected = selectedProductIds.includes(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => handleToggleSelectProduct(p.id)}
                          className={cn(
                            "w-full text-left px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center justify-between",
                            isSelected ? "bg-blue-50 text-blue-800" : "hover:bg-gray-100 text-gray-700"
                          )}
                        >
                          <span className="truncate">{p.name}</span>
                          {isSelected && <Check className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />}
                        </button>
                      );
                    })
                  ) : (
                    categoryPickList(categories).map(({ category: c, indent }) => {
                      const isSelected = selectedCategoryIds.includes(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => handleToggleSelectCategory(c.id)}
                          className={cn(
                            "w-full text-left px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center justify-between",
                            isSelected ? "bg-purple-50 text-purple-800" : "hover:bg-gray-100 text-gray-700"
                          )}
                        >
                          <span className="truncate">{indent}{c.name}</span>
                          {isSelected && <Check className="w-3.5 h-3.5 text-purple-600 flex-shrink-0" />}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              <p className="text-[0.625rem] text-gray-400 mt-2">
                Start typing a product name, then pick it from the list. Leave empty to apply to all products.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Field Options Configuration Drawer / Modal */}
      <AnimatePresence>
        {editingField && (
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-3xl rounded-3xl shadow-2xl border border-gray-100 overflow-hidden my-6"
            >
              {/* Modal Header */}
              <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/60">
                <div className="flex items-center space-x-2">
                  <span className="px-2.5 py-0.5 rounded-full bg-blue-600 text-white font-black text-xs">
                    {editingField.code || 'Field'}
                  </span>
                  <div>
                    <h3 className="text-lg font-black text-gray-900">{editingField.name}</h3>
                    <p className="text-[0.6875rem] text-gray-500 uppercase font-bold tracking-wider">
                      Group: {editingField.group.replace('_', ' ')}
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-3">
                  {/* Toggle Enable */}
                  <label className="flex items-center space-x-2 cursor-pointer bg-white px-3 py-1 rounded-xl border border-gray-200">
                    <span className="text-xs font-bold text-gray-700">Enabled</span>
                    <input
                      type="checkbox"
                      checked={editingField.enabled}
                      onChange={() => {
                        toggleFieldEnabled(editingField.id);
                        setEditedFieldIds((prev) => (prev.includes(editingField.id) ? prev : [...prev, editingField.id]));
                      }}
                      className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                    />
                  </label>

                  <button
                    type="button"
                    onClick={() => setEditingFieldId(null)}
                    className="p-1.5 rounded-full hover:bg-gray-200 text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Modal Body — the very editor the product dialog uses, so the
                  library can do everything a product can: rename, edit a price
                  in place, once-per-order charges, required, custom size, the
                  questions inside an option, and drag to reorder. */}
              <div className="p-6 max-h-[70vh] overflow-y-auto">
                <PrintingFieldEditorBody
                  field={editingField}
                  scopeNote={'This edits the SHARED library. Products receive it when you press "Update products…" and choose how — nothing on a product changes before that.'}
                  onUpdateField={handleLibraryFieldPatch}
                  onAddOption={handleLibraryAddOption}
                  onUpdateOption={handleLibraryOptionPatch}
                  onSetDefault={handleLibrarySetDefault}
                  onRemoveOption={handleLibraryRemoveOption}
                  onMoveOption={handleLibraryMoveOption}
                  onReorderOptions={handleLibraryReorderOptions}
                  onUploadOptionImage={async (file) => (await uploadOptionImage(file)).url}
                />
              </div>

              {/* Modal Footer.
                  Saving lives here as well as in the sidebar: this modal covers
                  the whole screen, so from inside it the sidebar's save button
                  is unreachable and edits look saved when they are not. */}
              <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/50 flex justify-between items-center gap-3">
                <button
                  type="button"
                  onClick={handleSaveLibrary}
                  disabled={savingLibrary}
                  className="flex items-center gap-2 px-5 py-2 bg-gray-900 text-white text-xs font-extrabold rounded-xl hover:bg-black transition-colors shadow-sm disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  {savingLibrary ? 'Saving…' : librarySaved ? 'Saved' : 'Save changes'}
                </button>

                <button
                  type="button"
                  onClick={() => setEditingFieldId(null)}
                  className="px-6 py-2 bg-blue-600 text-white text-xs font-extrabold rounded-xl hover:bg-blue-700 transition-colors shadow-sm"
                >
                  Done
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* HOW TO APPLY THE LIBRARY — see openApplyDialog and src/lib/libraryApply.ts.
          The choice that cannot take anything away is selected when it opens. */}
      <AnimatePresence>
        {applyDialogOpen && (
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl border border-gray-100 overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-start gap-3 bg-gray-50">
                <div>
                  <h3 className="text-base font-black text-gray-900">Update products from the library</h3>
                  <p className="text-[0.6875rem] font-bold text-gray-500 mt-0.5">
                    {targetProductIds.length} product{targetProductIds.length === 1 ? '' : 's'} —{' '}
                    {applyTarget === 'products'
                      ? selectedProductIds.length > 0
                        ? 'the products you picked'
                        : 'every product in the shop (nothing is picked on the right)'
                      : `the products in the ${selectedCategoryIds.length} categor${selectedCategoryIds.length === 1 ? 'y' : 'ies'} you picked`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setApplyDialogOpen(false)}
                  className="p-1 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-200"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-3 max-h-[65vh] overflow-y-auto">
                {([
                  [
                    'add-new',
                    'Add the new properties only (safest)',
                    'Every product keeps everything it has — its order, its prices, what is switched off. A property switched on here that a product does not have yet is added at the end, switched on.',
                  ],
                  [
                    'update-selected',
                    'Update the properties I choose',
                    'Only the properties you tick are replaced by the library version, on every product that has them — each product keeps its own place for them in the order and its own on/off. A product without one gets it added, if it is switched on here. Nothing else changes.',
                  ],
                  [
                    'replace-all',
                    'Replace everything with the library',
                    "Every product gets exactly the library: its order, its labels, its prices, its on/off. What was changed on a single product for these properties is lost. The quantity table, size calculator, artwork box and delivery time stay where you placed them on each product.",
                  ],
                ] as const).map(([mode, title, body]) => (
                  <label
                    key={mode}
                    className={cn(
                      'flex items-start gap-3 p-4 rounded-2xl border cursor-pointer transition-colors',
                      applyMode === mode
                        ? mode === 'replace-all'
                          ? 'border-red-300 bg-red-50'
                          : 'border-blue-400 bg-blue-50'
                        : 'border-gray-200 bg-white hover:border-gray-300',
                    )}
                  >
                    <input
                      type="radio"
                      name="library-apply-mode"
                      checked={applyMode === mode}
                      onChange={() => setApplyMode(mode)}
                      className="mt-0.5 w-4 h-4 text-blue-600 focus:ring-blue-500 shrink-0"
                    />
                    <span>
                      <span className="block text-xs font-black text-gray-900">{title}</span>
                      <span className="block text-[0.6875rem] font-bold text-gray-500 leading-relaxed mt-0.5">{body}</span>
                    </span>
                  </label>
                ))}

                {applyMode === 'update-selected' && (
                  <div className="p-4 rounded-2xl border border-blue-200 bg-white space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-black text-gray-800">
                        Properties to update ({applyFieldIds.length})
                      </span>
                      <span className="flex gap-2 text-[0.6875rem] font-black">
                        <button
                          type="button"
                          onClick={() => setApplyFieldIds(editedFieldIds.filter((id) => fields.some((f) => f.id === id)))}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          Only the ones I changed ({editedFieldIds.filter((id) => fields.some((f) => f.id === id)).length})
                        </button>
                        <button type="button" onClick={() => setApplyFieldIds([])} className="text-gray-500 hover:text-gray-800">
                          None
                        </button>
                      </span>
                    </div>
                    <input
                      type="text"
                      value={applyFieldSearch}
                      onChange={(e) => setApplyFieldSearch(e.target.value)}
                      placeholder="Find a property…"
                      className="w-full px-3 py-1.5 border border-gray-200 rounded-xl text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
                      {fields
                        .filter((f) => {
                          const q = applyFieldSearch.trim().toLowerCase();
                          return !q || f.name.toLowerCase().includes(q) || f.id.toLowerCase().includes(q);
                        })
                        .map((f) => {
                          const ticked = applyFieldIds.includes(f.id);
                          return (
                            <label
                              key={f.id}
                              className={cn(
                                'flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer',
                                ticked ? 'bg-blue-50 text-blue-900' : 'hover:bg-gray-50 text-gray-700',
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={ticked}
                                onChange={() =>
                                  setApplyFieldIds((prev) =>
                                    prev.includes(f.id) ? prev.filter((id) => id !== f.id) : [...prev, f.id],
                                  )
                                }
                                className="w-3.5 h-3.5 text-blue-600 rounded focus:ring-blue-500"
                              />
                              <span className="flex-1 truncate">{f.name}</span>
                              {editedFieldIds.includes(f.id) && (
                                <span className="text-[0.5625rem] font-black uppercase bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-md">
                                  changed now
                                </span>
                              )}
                              {!f.enabled && (
                                <span className="text-[0.5625rem] font-black uppercase bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-md">
                                  off
                                </span>
                              )}
                            </label>
                          );
                        })}
                    </div>
                  </div>
                )}

                {applyMode === 'update-selected' && (
                  <div className="p-4 rounded-2xl border border-gray-200 bg-white space-y-2">
                    <span className="block text-xs font-black text-gray-800">
                      On each product, the properties you ticked are…
                    </span>
                    {([
                      ['keep', 'left on or off, as each product has them'],
                      ['on', 'switched ON everywhere — customers see them'],
                      ['off', 'switched OFF everywhere — hidden from customers'],
                    ] as const).map(([key, text]) => (
                      <label key={key} className="flex items-center gap-2 text-[0.6875rem] font-bold text-gray-700 cursor-pointer">
                        <input
                          type="radio"
                          name="library-apply-switch"
                          checked={applySwitch === key}
                          onChange={() => setApplySwitch(key)}
                          className="w-3.5 h-3.5 text-blue-600 focus:ring-blue-500"
                        />
                        <span>{text}</span>
                      </label>
                    ))}
                  </div>
                )}

                {applyMode === 'replace-all' && (
                  <label className="flex items-start gap-2 p-3 rounded-2xl border border-red-200 bg-white cursor-pointer">
                    <input
                      type="checkbox"
                      checked={applyDropProductOnly}
                      onChange={(e) => setApplyDropProductOnly(e.target.checked)}
                      className="mt-0.5 w-3.5 h-3.5 text-red-600 rounded focus:ring-red-500"
                    />
                    <span className="text-[0.6875rem] font-bold text-red-800 leading-relaxed">
                      Also DELETE the properties that exist only on a product (its own custom properties and the
                      ones the AI analyzer made). Left unticked, they are kept, after the library ones.
                    </span>
                  </label>
                )}

                {applyPricing && (
                  <p className="text-[0.6875rem] font-black text-amber-900 bg-amber-50 border border-amber-300 rounded-xl px-3 py-2">
                    The prices ticked in the panel on the left will be written to these products too.
                  </p>
                )}
              </div>

              {/* Said HERE, where he is looking — the page's own error line sits
                  under this dialog's overlay. */}
              {applyError && (
                <p role="alert" className="mx-6 mb-3 text-xs font-bold text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                  {applyError}
                </p>
              )}

              <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setApplyDialogOpen(false)}
                  className="px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-900"
                >
                  {t('pfCancel')}
                </button>
                <button
                  type="button"
                  onClick={() => void handleUpdateAndApply()}
                  disabled={saving || (applyMode === 'update-selected' && applyFieldIds.length === 0)}
                  className={cn(
                    'px-5 py-2 text-white text-xs font-black rounded-xl transition-colors shadow-sm disabled:opacity-50',
                    applyMode === 'replace-all' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700',
                  )}
                >
                  {saving
                    ? 'Updating…'
                    : `Apply to ${targetProductIds.length} product${targetProductIds.length === 1 ? '' : 's'}`}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Create New Printing Field Modal */}
      <AnimatePresence>
        {isCreatingField && (
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-md rounded-3xl shadow-2xl border border-gray-100 overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                <div className="flex items-center space-x-2">
                  <Plus className="w-5 h-5 text-blue-600" />
                  <h3 className="text-base font-black text-gray-900">{t('pfNewFieldTitle')}</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsCreatingField(false)}
                  className="p-1 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-200"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-black text-gray-700 mb-1">Field Name</label>
                  <input
                    type="text"
                    value={newFieldName}
                    onChange={(e) => setNewFieldName(e.target.value)}
                    placeholder={t('pfFieldNamePlaceholder')}
                    className="w-full px-3.5 py-2 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-black text-gray-700 mb-1">{t('pfFieldCode')}</label>
                    <input
                      type="text"
                      value={newFieldCode}
                      onChange={(e) => setNewFieldCode(e.target.value)}
                      placeholder="60"
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-black text-gray-700 mb-1">{t('pfGroup')}</label>
                    <select
                      value={newFieldGroup}
                      onChange={(e) => setNewFieldGroup(e.target.value as PrintingFieldGroupType)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 bg-white"
                    >
                      <option value="online_design">Online Design</option>
                      <option value="default">Default</option>
                      <option value="product_builder">Product Builder</option>
                      <option value="upload_design">Upload Design</option>
                    </select>
                  </div>
                </div>

                <div className="bg-blue-50/50 p-3.5 rounded-2xl border border-blue-100 space-y-2">
                  <span className="block text-xs font-extrabold text-blue-900">{t('pfInitialOption')}</span>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={initialOptionLabel}
                      onChange={(e) => setInitialOptionLabel(e.target.value)}
                      placeholder={t('pfOptionNamePlaceholder')}
                      className="w-full px-3 py-1.5 border border-gray-200 rounded-xl text-xs font-bold bg-white"
                    />
                    <input
                      type="number"
                      value={initialOptionPrice}
                      onChange={(e) => setInitialOptionPrice(Number(e.target.value))}
                      placeholder={t('pfSurcharge')}
                      className="w-full px-3 py-1.5 border border-gray-200 rounded-xl text-xs font-bold bg-white"
                    />
                  </div>
                </div>
              </div>

              <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setIsCreatingField(false)}
                  className="px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-900"
                >
                  {t('pfCancel')}
                </button>
                <button
                  type="button"
                  onClick={handleCreateField}
                  disabled={!newFieldName.trim()}
                  className="px-5 py-2 bg-blue-600 text-white text-xs font-black rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
                >
                  {t('pfAddFieldAction')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {confirmDialog}
    </div>
  );
}
