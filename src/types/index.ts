import type { OutlineKind } from '../lib/shapes';

export type UserRole = 'admin' | 'staff' | 'production' | 'client';
export type AccountType = 'individual' | 'business';
export type OrderStatus = 'pending' | 'in_design' | 'in_print' | 'finishing' | 'shipped' | 'completed' | 'cancelled';

export interface StaffPermissions {
  canManageCategories?: boolean;
  canManageProducts?: boolean;
  canManageOrders?: boolean;
  canManageSiteCustomizer?: boolean;
  canManagePrintSettings?: boolean;
  canManagePrintingFields?: boolean;
}

export interface PointsTransaction {
  id: string;
  date: string;
  points: number;
  type: 'earned' | 'redeemed' | 'bonus';
  orderId?: string;
  description: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  role: UserRole;
  accountType: AccountType;
  companyName?: string;
  taxNumber?: string;
  phone?: string;
  // Written by the account form. They were absent from this type, so nothing
  // read them back: the form loaded blank every visit and the next save wrote
  // the blanks over the customer's stored address.
  firstName?: string;
  lastName?: string;
  address1?: string;
  address2?: string;
  postcode?: string;
  city?: string;
  country?: string;
  billingEmail?: string;
  notifyCampaigns?: boolean;
  status: 'active' | 'suspended';
  permissions?: StaffPermissions;
  loyaltyPoints?: number;
  loyaltyTier?: 'Silver' | 'Gold' | 'Platinum';
  pointsHistory?: PointsTransaction[];
  createdAt: string;
  /**
   * Set ONLY in the browser, never written: the profile could not be read (the
   * database refused), so this is a stand-in — not the account's real role, name or
   * points. `quota`: the free daily reads are used up, back at `backAt`.
   */
  profileUnavailable?: { quota: boolean; backAt: string | null };
}

export interface Category {
  id: string;
  name: string;
  /**
   * Per-language category name; falls back to `name`. Display only.
   *
   * The plain `name` stays the canonical one and is what every COMPARISON uses:
   * products file themselves by `categoryId` holding either the category's id
   * or its name — both forms are in the live data — and the printing-fields
   * "apply to a whole category" action, the delete-usage probe and the supplier
   * import all match on it. A translated string must never reach any of those,
   * or the join silently finds nothing and reports success.
   *
   * `null` means the owner cleared every translation. The write is a merge, so
   * an omitted key would be KEPT, not deleted.
   */
  nameI18n?: LocalizedText | null;
  description?: string;
  /** Per-language description; falls back to `description`. See `nameI18n`. */
  descriptionI18n?: LocalizedText | null;
  parentId?: string;
  image?: string;
  /** Hidden from the storefront without deleting the data. */
  isHidden?: boolean;
  /** Left out of the home page's category grid only; still in the web shop and its menu (2026-10-14). */
  hiddenOnHome?: boolean;
  /**
   * The owner's place for this category among its siblings — dragged into order
   * in the dashboard. Absent = after the arranged ones, by name. See
   * src/lib/ownerOrder.ts.
   */
  sortOrder?: number;
  /**
   * This category page's products, in the owner's order (ids). Products not in
   * it follow by name. Never sent to visitors — /api/catalogue sorts with it.
   */
  productOrder?: string[];
}

export interface DeliveryOption {
  id: string;
  name: string;
  deliveryDays: string;
  priceSurcharge: number;
  /** The surcharge is added once to the line, not per piece (src/lib/chargeOnce.ts). */
  chargeOnce?: boolean;
  /** Working days until dispatch, read the way the server reads them (src/lib/productionSpeed.ts). */
  lead?: { min: number; max: number } | null;
}

/**
 * Shop-owner text in the four shop languages. The plain string next to it stays
 * the fallback, so anything typed before this existed still renders.
 */
export type LocalizedText = Partial<Record<'en' | 'sv' | 'da' | 'no', string>>;

export interface PrintingFieldOption {
  id: string;
  label: string;
  /** Per-language label; falls back to `label` for any missing language. */
  labelI18n?: LocalizedText;
  value: string;
  priceModifier: number;
  isDefault?: boolean;
  /** e.g. '148 × 210 mm' — shown under the option card (HelloPrint-style). */
  dimensions?: string;
  /** Shows a "Recommended" badge on the option card. */
  recommended?: boolean;
  /** Small illustration on the option card (paper finish, fold type, …). */
  imageUrl?: string;
  /**
   * The cut outline this option stands for (src/lib/shapes.ts) — round, oval,
   * star … Absent = automatic (the catalogue's own shapes are known by id);
   * 'none' = this is not a shape. The owner's choice always wins.
   */
  outline?: OutlineKind | 'none';
  /**
   * Hidden from customers by the owner, and kept — so a shape he cannot make
   * this month comes back with one click. Not offered on the product page, and
   * refused by name if a basket saved earlier still carries it.
   */
  hidden?: boolean;
  /**
   * The owner hid (true) or showed (false) this option on THIS PRODUCT himself,
   * in the product dialog. A push from the property library keeps it; absent,
   * the library's `hidden` decides. Never written by the library screen.
   */
  hiddenOnProduct?: boolean;
  /**
   * CHARGED ONCE PER ORDER LINE, not once per piece.
   *
   * `priceModifier` is added to the UNIT price, so it is multiplied by the
   * quantity — right for a paper or a laminate, absurd for a cutting die, a
   * proof or a designer's fee: 100 stickers with a "new die +850 kr (one-off)"
   * cost 85 000 kr extra. With this set the amount is added to the line once.
   *
   * Absent means "whatever the catalogue says" — see isChargedOnce in
   * src/lib/chargeOnce.ts, which knows the catalogue's one-off options by id, so
   * the products already in the shop are charged correctly without rewriting
   * them. true / false is the owner's own choice and always wins.
   */
  chargeOnce?: boolean;
  /**
   * OPTIONS INSIDE THIS OPTION.
   *
   * Fields that exist only while this option is the chosen one — "اختيار داخل
   * الاختيار نفسه". It is how every real print catalogue works: pick "Printed on
   * a roll" and you are asked for a winding direction and a core size; pick
   * "Individual stickers" and you are asked for a cut shape instead. Those are
   * not the same question with different answers, they are different questions.
   *
   * Modelled as full PrintingFields rather than a flat list, so a sub-option
   * carries everything an option ever carries — surcharge, image, dimensions,
   * translations, custom size — with no second, weaker kind of option to
   * maintain.
   *
   * DEPTH IS CAPPED AT TWO LEVELS (see MAX_OPTION_DEPTH in
   * src/components/product/ProductConfigurator.tsx). A third level is a
   * configurator no shopper can hold in their head and a dashboard no owner can
   * edit; the cap is enforced, not merely advised.
   *
   * MONEY: a sub-option's priceModifier counts ONLY while its branch is the
   * chosen one, in the browser and on the server alike. A surcharge hiding
   * behind an option nobody picked must never reach a price.
   */
  subFields?: PrintingField[];
}

export type PrintingFieldGroupType = 'default' | 'online_design' | 'product_builder' | 'upload_design';

export interface VolumeDiscountTier {
  minQuantity: number;
  discountPercentage: number;
}

export interface CustomUploadRules {
  enabled: boolean;
  /**
   * PRICE THIS PRODUCT BY THE SQUARE METRE, and show the size calculator.
   *
   * It used to be `enabled` that did this — the same flag that says whether the
   * artwork rules below apply. So every product that accepted an upload also
   * silently grew an area surcharge (`areaSqm × pricePerSqm`) and a size
   * calculator nobody asked for: a rollup with a flat 1500 kr price was billing
   * 1622, the extra 122 coming from a 50 × 70 cm default the shopper never
   * chose. Nothing in the dashboard could turn it off, because `enabled` was
   * never on screen.
   *
   * Two questions, two flags now. This one defaults to OFF: a product is priced
   * by area only when the owner says so.
   */
  areaPriced?: boolean;
  minPrice: number;
  pricePerSqm?: number;
  pricePerLinearMeter?: number;
  maxWidthCm?: number;
  maxHeightCm?: number;
  allowedFormats?: string[];
  maxFileSizeMb?: number;
  requiresProofing?: boolean;
}

export interface PricingRules {
  baseSetupFee?: number;
  priceCalculationType?: 'fixed' | 'per_sqm' | 'per_linear_meter' | 'tiered_volume';
  volumeDiscounts?: VolumeDiscountTier[];
  expressRushFee?: number;
}

export interface PrintingField {
  id: string;
  code?: string;
  name: string;
  /** Per-language field name; falls back to `name` for any missing language. */
  nameI18n?: LocalizedText;
  group: PrintingFieldGroupType;
  enabled: boolean;
  required?: boolean;
  options: PrintingFieldOption[];
  /** Short helper text behind the little info icon next to the field name. */
  description?: string;
  /** Per-language helper text; falls back to `description`. */
  descriptionI18n?: LocalizedText;
  /**
   * The owner has arranged this field's options by hand — 15.5.7.
   *
   * Set the first time he presses a move arrow on this field, and read by the
   * garment-size grid, which otherwise re-sorts its tiles into real size order
   * (S before M before L, never alphabetical). That sort is right for a size
   * field nobody has touched and wrong the moment he has decided an order
   * himself: he would press the arrows, watch the dashboard reorder, open the
   * shop and find the old order — the same "I can't arrange them" he started
   * from. Absent means "no opinion", which is why it is a flag and not a
   * default.
   */
  keepOwnerOrder?: boolean;
  /**
   * How the product page shows the options — his switch (round 16, item 4).
   * Absent = automatic: cards for six or fewer, a dropdown above that, and the
   * colour and garment-size layouts where they apply. 'cards' shows picture
   * tiles however many there are (a shape is drawn when it has no picture);
   * 'list' always a dropdown.
   */
  display?: 'cards' | 'list';
  /**
   * This question chooses the CUT SHAPE (src/lib/shapes.ts) — his tick, either
   * way. Absent: the catalogue's own shape questions only. Never read from the
   * question's name, which he can change and which says "shape" on corners,
   * holes and flags too.
   */
  cutShape?: boolean;
  customSettings?: Record<string, any>;
  customUploadRules?: CustomUploadRules;
  pricingRules?: PricingRules;
  /**
   * Adds a "Custom size" card to this field's options: the customer types their
   * own width × height in cm (HelloPrint-style), priced by the existing
   * area-based rules. The bounds below are the owner's limits per axis; a
   * missing bound leaves that side open.
   */
  allowCustomSize?: boolean;
  minWidthCm?: number;
  maxWidthCm?: number;
  minHeightCm?: number;
  maxHeightCm?: number;
}

/** A list the owner authors once per language — features, in practice. */
export type LocalizedList = Partial<Record<'en' | 'sv' | 'da' | 'no', string[]>>;

/** One row of the product page's specification table. */
export interface ProductSpec {
  label: string;
  value: string;
  labelI18n?: LocalizedText;
  valueI18n?: LocalizedText;
}

/** One entry of the product page's frequently-asked-questions section. */
export interface ProductFaq {
  q: string;
  a: string;
  qI18n?: LocalizedText;
  aI18n?: LocalizedText;
}

export interface Product {
  id: string;
  name: string;
  /**
   * Who supplied it, for the owner to read — "يجب وضع اسم Supplier".
   *
   * A DISPLAY name ("Pro Media Plus"), not the slug the adapters use
   * ("promediaplus"); the slug stays in productCosts, where the re-sync matches
   * on it. Absent on a product the owner built himself, and that absence is
   * meaningful: it is how the dashboard tells his own range from an imported one.
   *
   * These two are NOT the cost fields. sourcePrice, sourceRate, marginPercent,
   * supplier, supplierUrl were moved out of this document on 2026-09-09 because
   * `products` is world-readable and together they let a competitor price
   * against us. A name and a row id do not, and the name is already public here
   * anyway — `brand` falls back to it when a feed carries no producer.
   */
  supplierName?: string | null;
  supplierOfferId?: string | null;
  /**
   * Per-language product name; falls back to `name`. The storefront localises,
   * but the cart, orders and production screens deliberately keep the canonical
   * `name` — staff and the printer should read one stable title for a job no
   * matter which language the customer bought in.
   */
  nameI18n?: LocalizedText | null;
  description: string;
  /** Per-language description; falls back to `description`. `null` = cleared. */
  descriptionI18n?: LocalizedText | null;
  categoryId: string;
  /** Hidden from the storefront without deleting the data. */
  isHidden?: boolean;
  /**
   * The name part of the product's web address — `premium-card` in
   * /products/premium-card. Derived from the name when the product is saved;
   * see src/lib/slug.ts. Products written before this existed have none, and
   * the product page falls back to matching the name itself.
   */
  slug?: string | null;
  basePrice: number;
  /**
   * SPECIAL OFFER PRICE. Net SEK, exactly like basePrice.
   *
   * Set it and the shop charges this instead, strikes through basePrice
   * everywhere it is shown, and puts an offer badge on the product. Clear it
   * (null) and the product goes back to its list price. It is honoured only
   * when it is above zero and genuinely below basePrice — see
   * calcConfiguredItemPrice, which is the one place that decides.
   *
   * A product priced at an offer cannot also be discounted with a coupon code;
   * that rule lives on the server, in the coupon block of priceCart.
   */
  salePrice?: number | null;
  images: string[];
  /**
   * The OLD "Custom Product Options". Never read by the shop or the server — the
   * product page renders `printingFields` — so nothing typed here ever reached a
   * customer. No longer written; a product that still carries some is offered a
   * conversion to properties in the product dialog.
   */
  options?: ProductOption[];
  isWeb2Print: boolean;

  /**
   * WHAT GOOGLE IS TOLD ABOUT THIS PRODUCT.
   *
   * All optional, all blank by default: with nothing filled in the page keeps
   * behaving exactly as it did, building its title from the name and its
   * description from the product text. These exist because that generated
   * description is the SAME sentence on every product with an empty description,
   * and Google does not rank a page whose text it has already seen nine times.
   *
   * The server reads them straight out of the product document (server-seo.ts),
   * so a description written here is in the page source on the next request —
   * there is no build step between the dashboard and the crawler.
   */
  seoTitle?: string;
  seoDescription?: string;
  /** Keep this product out of Google while leaving it on sale. */
  seoNoindex?: boolean;
  /** Keep it out of the sitemap only — Google may still index it if it finds it. */
  seoExcludeFromSitemap?: boolean;

  /**
   * Google Shopping attributes.
   *
   * `brand` also feeds the schema.org Product block on the page, so the rich
   * result and the Merchant Center feed cannot disagree about who makes it.
   * Custom print usually has no barcode at all, and that is a legitimate answer:
   * with no gtin and no mpn the feed says `identifier_exists: no`, which is what
   * stops Google rejecting the item for a barcode that was never going to exist.
   */
  brand?: string;
  gtin?: string;
  mpn?: string;
  condition?: 'new' | 'refurbished' | 'used';
  /** Google's own product taxonomy — an id, or the full "A > B > C" path. */
  googleProductCategory?: string;
  minQuantity?: number;
  maxQuantity?: number;
  deliverySpeedOptions?: DeliveryOption[];
  features?: string[];
  /** Per-language feature list; falls back to `features`. */
  featuresI18n?: LocalizedList;
  /** Specification table shown on the product page. */
  specs?: ProductSpec[];
  /** Frequently-asked questions shown on the product page. */
  faq?: ProductFaq[];
  printingFields?: PrintingField[];
  /**
   * WHERE THE QUANTITY TABLE SITS among the fields above.
   *
   * The product page used to be three sections hard-coded in the component —
   * print, artwork, then delivery-and-services — with the quantity ladder always
   * last. So a shop could not ask "how many?" before "how fast?", however wrong
   * that reads, and the owner had no control at all over the order of anything.
   *
   * Fields now render in the order of `printingFields`, which the dashboard's
   * arrows rewrite, and this says which field the quantity table follows.
   * Undefined keeps it where it has always been, below the artwork block, so an
   * untouched product looks exactly as it did.
   */
  quantityAfterFieldId?: string | null;
  /**
   * EVERY ROW of the product page in his order (src/lib/pageOrder.ts): the
   * property ids and the blocks — '__quantity__', '__size__' (the per-m² size
   * calculator), '__artwork__' (the upload box), '__delivery__'. The client
   * could drag his properties but not the blocks below them (round 16).
   * Absent = the layout every product has always had; the two fields above are
   * still written beside it, so they keep telling the same story.
   */
  pageOrder?: string[] | null;
  /**
   * SUGGESTED PRODUCTS under this one, in his order — his picks, at most four
   * (src/lib/suggestions.ts). The page sends them with the request, so the
   * suggestion row costs no read of its own. Absent: the shop fills the row from
   * the product's category, as Site Settings says.
   */
  relatedProductIds?: string[] | null;
  customUploadRules?: CustomUploadRules;
  pricingRules?: PricingRules;
  stock?: number;
  createdAt?: string;

  /**
   * Does this product offer an artwork upload at all?
   *
   * THE DEFAULT IS OFF, and the absent value is load-bearing. A product with no
   * value shows no upload box — the question is answered in exactly one place,
   * `artworkBoxShown` in src/lib/artwork.ts, which the storefront, the product
   * editor and the order pipeline all call.
   *
   * It was the other way round until 2026-09-13, when the owner's client found
   * "YOUR ARTWORK · Click or drop your file here" on an acrylic display stand —
   * a finished good nothing is printed on — and on all 109 other products,
   * because not one of them had this field set and "not set" meant SHOWN.
   * Inverting the default took the box off every product without a single write.
   */
  artworkEnabled?: boolean;

  /**
   * Must the shopper attach the print file before this product can be bought?
   *
   * Undefined and false both mean NO: a customer may order first and send the
   * artwork afterwards, which is how the shop actually works — a phone order,
   * a repeat job, a file still with the customer's designer. The line is then
   * marked `artworkPending` so production can see, at a glance, that it is
   * waiting for a file rather than that somebody forgot to attach one.
   *
   * ONLY MEANINGFUL WHILE `artworkEnabled` IS TRUE. A product whose upload box is
   * off is never waiting for a file — see `artworkExpected` in src/lib/artwork.ts,
   * which is what the order pipeline stamps `artworkPending` from. Without that,
   * every order on a shop whose box defaults to off is filed as awaiting artwork
   * and the customer is emailed asking for a file nobody ever offered to take.
   *
   * Only set this to true for a product that genuinely cannot be produced
   * without the file in hand.
   */
  artworkRequired?: boolean;

  /**
   * May customers design this product online, in the browser (round 16, item 5)?
   *
   * Absent means YES, wherever the upload box is shown: the owner's answer was
   * "all products, or the client picks". `false` is his tick-box taking it off
   * one product. The rule is src/lib/onlineDesign.ts, shared by the product page
   * and the editor.
   */
  onlineDesign?: boolean;
  /**
   * Designer v2: the owner's own print values for THIS product (bleed, safe area,
   * hidden zones, resolution); absent = the defaults for its kind and size
   * (src/lib/printSpec.ts printSpecFor / cleanSpecOverride).
   */
  printSpec?: {
    bleedMm?: number | null;
    safeMm?: number | null;
    /** Per side; a side not given (or null) is the usual value for the kind. */
    hiddenMm?: { top?: number | null; right?: number | null; bottom?: number | null; left?: number | null } | null;
    targetDpi?: number | null;
    minDpi?: number | null;
  } | null;

  /**
   * The owner's own stock-keeping code, printed on the production work order
   * next to the item so the press operator can match it to a supplier line.
   * Free text — the shop's numbering scheme is not ours to invent.
   */
  sku?: string;
}

export interface PrintSettings {
  maxWidthCm: number;             // Default 28 cm
  pricePerLinearMeter: number;    // Default 250 kr
  minPrice: number;               // Default 149 kr
  allowedFormats: string[];       // e.g. ['pdf', 'png', 'jpg', 'jpeg', 'svg', 'eps', 'tiff', 'psd', 'ai']
  currencySymbol: string;         // e.g. 'SEK' or 'kr'
  // Upload ceiling. Artwork is base64-encoded (~1.37x) and has to survive both
  // the ~5 MB localStorage cart and the 1 MiB Firestore document limit, so this
  // has to stay small until uploads move to object storage.
  maxFileSizeMb?: number;
  // VAT as a percentage, e.g. 25 for Swedish standard moms. Owned by the shop
  // rather than hardcoded, so reduced rates (12, 6) or a 0 export rate can be set
  // without a code change. Every price the shop quotes is entered NET and this is
  // added on top.
  vatRatePercent?: number;
}

export interface CustomUploadItem {
  id: string;
  fileName: string;
  fileSize: string;
  fileType: string;
  fileUrl?: string;
  widthCm: number;
  heightCm: number;
  heightMeters: number;
  calculatedPrice: number;
  finalUnitPrice: number;
  isMinPriceApplied: boolean;
  quantity: number;
  totalPrice: number;
}

export interface ProductOption {
  id: string;
  name: string;
  type: 'select' | 'radio' | 'number';
  values: { label: string; priceModifier: number }[];
}

export interface OrderItem {
  productId: string;
  productName: string;
  quantity: number;
  price: number;
  /** Frozen when ordered (2026-10): the product's category, for the dashboard's charts. */
  categoryId?: string | null;
  /** Frozen when ordered (2026-10): the product's own picture (http/https), for the job sheet and packing slip. */
  productImage?: string | null;
  designData?: string;
  fileSpecs?: {
    fileName: string;
    fileUrl?: string;
    widthCm: number;
    heightCm: number;
    fileType: string;
    storagePath?: string | null;
    bleedMm?: number | null;
    dpi?: number | null;
    template?: string | null;
    templateId?: string | null;
    placeBy?: 'trimbox' | 'bleedbox' | null;
    pageWidthMm?: number | null;
    pageHeightMm?: number | null;
    /** A studio design (designer v2): a small picture of each page — show THESE, never the print file. */
    previews?: Array<{ side: 'front' | 'back'; url: string }> | null;
    /** …and the pages its file holds, in print order. */
    sides?: Array<'front' | 'back'> | null;
    pages?: number | null;
  };
  options?: Record<string, string>;
  /** Net unit price the line was sold at (orders before 2026-08 may lack it). */
  unitPrice?: number;
  /**
   * WHAT `price` HOLDS BEYOND unitPrice × quantity — both net, both already in
   * `price`, never added again. The per-line setup fee, and the options charged
   * once per line (src/lib/chargeOnce.ts). Orders placed before 2026-10 have
   * neither; their `price` still includes the setup fee.
   */
  setupFee?: number;
  onceCharges?: number;
  onceOptions?: { label: string; amount: number }[];
  /** The product's SKU as it was at the time of the order. */
  sku?: string;
  /**
   * No print file came with this line. Set when the product allows ordering
   * without artwork, so the staff screens can shout about it instead of
   * showing an empty thumbnail that looks like a broken image.
   */
  artworkPending?: boolean;
  /** The shop provides this line's artwork: a reprint of an earlier order, or the studio's design (src/lib/artwork.ts). */
  artworkSource?: 'reprint' | 'studio';
}

export interface Order {
  /**
   * WHO THIS WAS SOLD TO, FOR TAX — frozen at the moment of sale, never
   * recomputed. Rules change; what an order was sold under does not.
   *
   * `vatRegimeApplied` is the difference between "this is what we charged" and
   * "this is what we would have charged": until the owner switches
   * printSettings.applyVatRegimes on, every order RECORDS its regime and still
   * pays the standard rate. Without this flag a historical order is unreadable
   * once the switch moves.
   */
  buyerType?: 'private' | 'company';
  buyerCountryCode?: string | null;
  buyerVatNumber?: string | null;
  vatRegime?: 'domestic' | 'eu_b2c' | 'eu_b2b_reverse' | 'export';
  vatRegimeApplied?: boolean;
  vatStandardRate?: number;
  vatRegimeRate?: number;
  /** A reverse charge rests on a VAT number nobody has checked against VIES. */
  vatRequiresVerification?: boolean;
  /** The sentence the invoice must carry. Printed only when the regime was applied. */
  vatInvoiceNote?: string | null;
  vatRegimeReason?: string | null;
  /**
   * The kreditnota numbers issued against this order.
   *
   * An issued invoice cannot be edited or deleted under Swedish rules, so a
   * refund is a separate document and the invoice points at it. The documents
   * themselves are in `creditNotes`, readable by the buyer and by staff.
   */
  creditNoteNumbers?: string[];
  /**
   * Cumulative, in the shop's currency. A PARTIAL refund deliberately leaves the
   * order at `paid`, so this is the only field that says any money went back.
   */
  refundedAmount?: number;
  id: string;
  userId: string;
  customerName: string;
  customerEmail: string;
  status: OrderStatus;
  totalAmount: number;
  /**
   * 'unpaid' means we are still waiting — the payment may yet arrive.
   * 'failed' | 'canceled' | 'expired' are Mollie's terminal outcomes: no money
   * came and none is coming, so staff can tell a dead order from a live one.
   */
  paymentStatus: 'unpaid' | 'paid' | 'refunded' | 'chargeback' | 'failed' | 'canceled' | 'expired';
  items: OrderItem[];
  assignedStaffId?: string;
  assignedStaffName?: string;
  notes?: string;
  shippingAddress?: {
    city?: string;
    street?: string;
    phone?: string;
  };
  pointsEarned?: number;
  pointsRedeemed?: number;
  pointsDiscountAmount?: number;
  createdAt: string;
  updatedAt?: string;
  deliveredAt?: string;

  // Everything below is written by createOrder in server.ts and was missing
  // here, so every screen that printed it reached for it through `as any` or
  // did not print it at all. The server is the only writer; these are the shape
  // of what it writes.
  publicToken?: string;
  customerDetails?: Record<string, any>;
  paymentMethod?: string | null;
  /** Human label for paymentMethod, e.g. 'Card, Swish or bank (Mollie)'. */
  paymentMethodTitle?: string | null;
  /**
   * Placed to PAY ON DELIVERY by a customer the owner chose: in production from
   * the start, `unpaid` until the owner records the payment.
   */
  payOnDelivery?: boolean;
  shippingMethod?: string | null;
  /** Human label for shippingMethod, printed on the invoice and work order. */
  shippingMethodTitle?: string | null;

  /**
   * The order's draft inside Zendr, the platform the shop books freight
   * through. Written by the server when the payment lands — or by the back
   * office's retry button. See src/lib/zendr.ts.
   */
  zendr?: {
    importedOrderId?: number;
    /** Deep link that opens this draft in the Zendr portal, ready to book. */
    portalUrl?: string;
    createdAt?: string;
    error?: string | null;
    failedAt?: string;
  } | null;
  /** What Zendr last said about the parcel. Null until a shipment is booked. */
  shipment?: {
    trackingNumber?: string | null;
    status?: 'APPROVED' | 'SHIPPED' | 'IN_TRANSIT' | 'DELIVERED' | 'REJECTED' | 'CANCELLED' | null;
    carrier?: string | null;
    pickupDate?: string | null;
    lastUpdated?: string | null;
    checkedAt?: string;
  } | null;
  /** False once the parcel is delivered, refused or cancelled — the sweep's filter. */
  shipmentOpen?: boolean;
  /** Where this order's artwork and paperwork were filed in the owner's Drive. */
  drive?: {
    folderId?: string;
    folderUrl?: string;
    files?: number;
    syncedAt?: string;
    error?: string | null;
    failedAt?: string;
  } | null;
  shippingCost?: number;
  currency?: string;
  /** Fraction, not a percentage: 0.25 is Swedish standard VAT. */
  vatRate?: number;
  /** Order value excluding shipping and VAT. */
  goodsNet?: number;
  /** Everything except VAT. */
  netTotal?: number;
  vatAmount?: number;
  /** netTotal + vatAmount. The same number as totalAmount. */
  grossTotal?: number;
  taxAmount?: number;
  subtotal?: number;
  discountCode?: string | null;
  discountAmount?: number;
  /** Set by the server so a reader can tell a server-priced order from a legacy one. */
  priceVerified?: boolean;
  /** The customer's instructions. Stored under both names; readers use `notes`. */
  comments?: string;
  termsAccepted?: boolean;
  termsAcceptedAt?: string;
  molliePaymentId?: string;
  molliePaymentStatus?: string;
  paymentProvider?: string;
  paymentMode?: 'live' | 'test';
  paidAt?: string | null;
  paymentMismatch?: boolean;

  /**
   * The day this order is promised to the customer, as YYYY-MM-DD.
   *
   * Written by the server from the shop's own lead times (production days +
   * the shipping days of the chosen method, both set by the admin) and then
   * editable by staff on the order card — a real print shop re-promises jobs
   * all the time and a computed date nobody can move is worse than none.
   */
  dueDate?: string;
  /** Set by staff — 'urgent' | 'high'; absent or null means normal. See src/lib/orderQueue.ts. */
  priority?: 'high' | 'urgent' | null;
  /** The day the job is planned for the press, 'YYYY-MM-DD'; set by staff. */
  printDate?: string | null;
  /** True while any line of this order is still waiting for its artwork. */
  artworkPending?: boolean;
  /**
   * Which signed-in account may see this order in "My orders".
   *
   * Equal to `userId` for a customer who was signed in when they bought. For a
   * guest checkout it is the account whose email matches, resolved once by the
   * server. It is deliberately NOT `userId`: loyalty points and the
   * once-per-customer coupon rule read `userId`, and those must never follow an
   * email address typed into a form.
   */
  customerAccountId?: string | null;

  // ---- the automatic production stages -----------------------------------
  // Written when the payment is confirmed and walked forward by the sweep in
  // server.ts. See src/lib/orderStages.ts for the schedule these describe.

  /** One timestamp per stage, measured from the moment the order was paid. */
  stagePlan?: Partial<Record<'in_design' | 'in_print' | 'finishing' | 'shipped' | 'completed', string>> | null;
  /**
   * When this order is next due to move. The sweep's ONLY query is on this
   * field, so an order that must not move automatically — unpaid, finished,
   * waiting for artwork — carries null here and costs nothing to ignore.
   */
  nextStageAt?: string | null;
  /** Who set the current stage. A manual move re-plans everything after it. */
  stageSource?: 'auto' | 'manual';
  /** Why the schedule stopped, when it did. Cleared by any manual move. */
  stageHold?: 'unpaid' | 'terminal' | 'artwork_pending' | 'artwork_by_shop' | null;
  /** When the stage last changed. */
  stageChangedAt?: string;
  /** The last 20 stage changes, whoever made them. */
  stageHistory?: { stage: string; at: string; by: string }[];
}
