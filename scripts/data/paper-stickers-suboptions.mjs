/**
 * PAPER STICKERS — the product the owner asked for, and the one that shows what
 * sub-options are for.
 *
 * He sent two screenshots of helloprint.com/sv-se/paperstickers-… and pointed at
 * the thing that changes between them: choose "Individuell" and the Form row
 * offers three shapes; choose "Tryckt på rulle" and the same row offers four,
 * with the oval added. They are not one question with a longer list — they are
 * two different questions that happen to sit in the same place.
 *
 * So the shape of this product is:
 *
 *   Typ ─┬─ Individual ──── Shape ─┬─ Round ───── Size (30/40/50/60 mm)
 *        │                         ├─ Square ──── Size (40/50/70 mm)
 *        │                         └─ Rectangle ─ Size (50×25 / 70×40 / 90×50)
 *        │
 *        └─ On a roll ───── Shape ─┬─ Round ───── Size (10/20/30/40 mm)
 *                                  ├─ Square ──── Size (20/30/40 mm)
 *                                  ├─ Rectangle ─ Size (30×15 / 50×25)
 *                                  └─ Oval ────── Size (35×25 / 50×30)
 *
 * Three levels, which is the deepest this shop allows (MAX_OPTION_DEPTH = 2 in
 * src/lib/optionTree.ts — a field at depth 0, 1 and 2).
 *
 * Every label carries sv/da/no. Owner-authored option text cannot live in
 * translations.ts, so it travels with the option as labelI18n and is resolved at
 * render time by src/lib/localizedText.ts.
 *
 * NOTHING carries `required: true`. Sixty-six catalogue fields once shipped with
 * it and broke checkout for every basket saved before the change; the
 * configurator preselects a default for every field anyway.
 */

/** A size choice. `dimensions` is what the card prints under the label. */
const size = (id, label, dimensions, priceModifier = 0, isDefault = false) => ({
  id,
  label,
  value: id.replace(/^size_/, ''),
  priceModifier,
  dimensions,
  ...(isDefault ? { isDefault: true } : {}),
});

/** Sizes are numbers and units — identical in all four languages, so no i18n. */
const sizeField = (id, name, options) => ({
  id,
  name,
  nameI18n: { sv: 'Storlek', da: 'Størrelse', no: 'Størrelse' },
  group: 'product_builder',
  enabled: true,
  description: 'The finished size of one sticker.',
  descriptionI18n: {
    sv: 'Den färdiga storleken på ett klistermärke.',
    da: 'Den færdige størrelse på ét klistermærke.',
    no: 'Den ferdige størrelsen på ett klistremerke.',
  },
  options,
});

const SHAPE_I18N = {
  round: { sv: 'Rund', da: 'Rund', no: 'Rund' },
  square: { sv: 'Kvadrat', da: 'Kvadrat', no: 'Kvadrat' },
  rectangle: { sv: 'Rektangel', da: 'Rektangel', no: 'Rektangel' },
  oval: { sv: 'Oval', da: 'Oval', no: 'Oval' },
};

const shapeField = (id, options) => ({
  id,
  name: 'Shape',
  nameI18n: { sv: 'Form', da: 'Form', no: 'Form' },
  group: 'product_builder',
  enabled: true,
  description: 'The outline each sticker is cut to. The sizes below follow the shape you pick.',
  descriptionI18n: {
    sv: 'Konturen varje klistermärke skärs till. Storlekarna nedan följer formen du väljer.',
    da: 'Konturen hvert klistermærke skæres til. Størrelserne nedenfor følger den form, du vælger.',
    no: 'Konturen hvert klistremerke skjæres til. Størrelsene under følger formen du velger.',
  },
  options,
});

export const PAPER_STICKERS = {
  id: 'prod-paper-stickers',
  name: 'Paper Stickers',
  nameI18n: {
    sv: 'Pappersklistermärken',
    da: 'Papirklistermærker',
    no: 'Papirklistremerker',
  },
  description:
    'Paper stickers you can write on. Perfect for packaging, branding and campaigns — cut to the shape you need, individually or printed on a roll for a dispenser. Indoor use, matt finish, easy to sign by hand.',
  descriptionI18n: {
    sv: 'Pappersklistermärken som går att skriva på. Perfekta för förpackningar, varumärkesbyggande och kampanjer — skurna i den form du behöver, individuellt eller tryckta på rulle för en dispenser. För inomhusbruk, matt yta, lätta att signera för hand.',
    da: 'Papirklistermærker, du kan skrive på. Perfekte til emballage, branding og kampagner — skåret i den form, du har brug for, enkeltvis eller trykt på rulle til en dispenser. Til indendørs brug, mat overflade, nem at skrive på i hånden.',
    no: 'Papirklistremerker du kan skrive på. Perfekte til emballasje, merkevarebygging og kampanjer — skåret i formen du trenger, enkeltvis eller trykt på rull for en dispenser. For innendørs bruk, matt overflate, lett å signere for hånd.',
  },
  categoryId: 'labels',
  isHidden: false,
  isWeb2Print: true,
  artworkRequired: false,
  sku: 'PAP-STK',

  // Per STICKER. A sticker is bought by the hundred, so the ladder does the work.
  basePrice: 3,
  minQuantity: 100,
  maxQuantity: 10000,
  stock: 100000,

  images: ['/product-art/stickers-1.svg', '/product-art/stickers-2.svg', '/product-art/stickers-3.svg'],

  pricingRules: {
    baseSetupFee: 99,
    priceCalculationType: 'tiered_volume',
    volumeDiscounts: [
      { minQuantity: 250, discountPercentage: 10 },
      { minQuantity: 500, discountPercentage: 20 },
      { minQuantity: 1000, discountPercentage: 30 },
      { minQuantity: 5000, discountPercentage: 40 },
    ],
  },

  // enabled: false ON PURPOSE.
  //
  // The area rule adds a per-square-metre surcharge to anything that leaves it
  // on, and this product is sized by the option tree above — a 20 mm round
  // sticker priced against a 50 × 70 cm default sheet would quote about 120 kr
  // FOR ONE STICKER. The size the customer picks is what they pay for here.
  customUploadRules: {
    enabled: false,
    minPrice: 0,
    allowedFormats: ['PDF', 'AI', 'EPS', 'SVG', 'PNG', 'JPG'],
    maxFileSizeMb: 50,
  },

  deliverySpeedOptions: [
    { id: 'standard', name: 'Standard Delivery', deliveryDays: '3-5 Business Days', priceSurcharge: 0 },
    { id: 'express', name: 'Express Delivery', deliveryDays: '1-2 Business Days', priceSurcharge: 95 },
  ],

  options: [],

  printingFields: [
    // ── 1. TYPE — the choice that decides which further questions exist ──────
    {
      id: 'stickers_type',
      name: 'Type',
      nameI18n: { sv: 'Typ', da: 'Type', no: 'Type' },
      group: 'product_builder',
      enabled: true,
      description: 'Individual stickers come cut and loose. On a roll they are wound for a dispenser.',
      descriptionI18n: {
        sv: 'Individuella klistermärken levereras skurna och lösa. På rulle lindas de för en dispenser.',
        da: 'Individuelle klistermærker leveres skåret og løse. På rulle vikles de til en dispenser.',
        no: 'Individuelle klistremerker leveres skåret og løse. På rull vikles de for en dispenser.',
      },
      options: [
        {
          id: 'type_individual',
          label: 'Individual',
          labelI18n: { sv: 'Individuell', da: 'Individuel', no: 'Individuell' },
          value: 'individual',
          priceModifier: 0,
          isDefault: true,
          imageUrl: '/product-art/sticker-type-individual.svg',
          subFields: [
            shapeField('shape_individual', [
              {
                id: 'ind_round',
                label: 'Round',
                labelI18n: SHAPE_I18N.round,
                value: 'round',
                priceModifier: 0,
                isDefault: true,
                imageUrl: '/product-art/shape-round.svg',
                subFields: [
                  sizeField('size_ind_round', 'Size', [
                    size('size_ind_round_30', '30 mm', '30 mm ø', 0, true),
                    size('size_ind_round_40', '40 mm', '40 mm ø', 1),
                    size('size_ind_round_50', '50 mm', '50 mm ø', 2),
                    size('size_ind_round_60', '60 mm', '60 mm ø', 3),
                  ]),
                ],
              },
              {
                id: 'ind_square',
                label: 'Square',
                labelI18n: SHAPE_I18N.square,
                value: 'square',
                priceModifier: 0,
                imageUrl: '/product-art/shape-square.svg',
                subFields: [
                  sizeField('size_ind_square', 'Size', [
                    size('size_ind_square_40', '40 × 40 mm', '40 × 40 mm', 0, true),
                    size('size_ind_square_50', '50 × 50 mm', '50 × 50 mm', 2),
                    size('size_ind_square_70', '70 × 70 mm', '70 × 70 mm', 4),
                  ]),
                ],
              },
              {
                id: 'ind_rect',
                label: 'Rectangle',
                labelI18n: SHAPE_I18N.rectangle,
                value: 'rectangle',
                priceModifier: 0,
                imageUrl: '/product-art/shape-rectangle.svg',
                subFields: [
                  sizeField('size_ind_rect', 'Size', [
                    size('size_ind_rect_5025', '50 × 25 mm', '50 × 25 mm', 0, true),
                    size('size_ind_rect_7040', '70 × 40 mm', '70 × 40 mm', 2),
                    size('size_ind_rect_9050', '90 × 50 mm', '90 × 50 mm', 4),
                  ]),
                ],
              },
            ]),
          ],
        },
        {
          id: 'type_roll',
          label: 'Printed on a roll',
          labelI18n: { sv: 'Tryckt på rulle', da: 'Trykt på rulle', no: 'Trykt på rull' },
          value: 'roll',
          // Winding and coring a roll is a finishing step, so it costs.
          priceModifier: 1,
          imageUrl: '/product-art/sticker-type-roll.svg',
          subFields: [
            // The SAME question, a different set of answers — the oval exists
            // only here, exactly as on the page the owner sent.
            shapeField('shape_roll', [
              {
                id: 'roll_round',
                label: 'Round',
                labelI18n: SHAPE_I18N.round,
                value: 'round',
                priceModifier: 0,
                isDefault: true,
                imageUrl: '/product-art/shape-round.svg',
                subFields: [
                  sizeField('size_roll_round', 'Size', [
                    size('size_roll_round_10', '10 mm', '10 mm ø', 0, true),
                    size('size_roll_round_20', '20 mm', '20 mm ø', 1),
                    size('size_roll_round_30', '30 mm', '30 mm ø', 2),
                    size('size_roll_round_40', '40 mm', '40 mm ø', 3),
                  ]),
                ],
              },
              {
                id: 'roll_square',
                label: 'Square',
                labelI18n: SHAPE_I18N.square,
                value: 'square',
                priceModifier: 0,
                imageUrl: '/product-art/shape-square.svg',
                subFields: [
                  sizeField('size_roll_square', 'Size', [
                    size('size_roll_square_20', '20 × 20 mm', '20 × 20 mm', 0, true),
                    size('size_roll_square_30', '30 × 30 mm', '30 × 30 mm', 1),
                    size('size_roll_square_40', '40 × 40 mm', '40 × 40 mm', 2),
                  ]),
                ],
              },
              {
                id: 'roll_rect',
                label: 'Rectangle',
                labelI18n: SHAPE_I18N.rectangle,
                value: 'rectangle',
                priceModifier: 0,
                imageUrl: '/product-art/shape-rectangle.svg',
                subFields: [
                  sizeField('size_roll_rect', 'Size', [
                    size('size_roll_rect_3015', '30 × 15 mm', '30 × 15 mm', 0, true),
                    size('size_roll_rect_5025', '50 × 25 mm', '50 × 25 mm', 2),
                  ]),
                ],
              },
              {
                id: 'roll_oval',
                label: 'Oval',
                labelI18n: SHAPE_I18N.oval,
                value: 'oval',
                priceModifier: 1,
                imageUrl: '/product-art/shape-oval.svg',
                subFields: [
                  sizeField('size_roll_oval', 'Size', [
                    size('size_roll_oval_3525', '35 × 25 mm', '35 × 25 mm', 0, true),
                    size('size_roll_oval_5030', '50 × 30 mm', '50 × 30 mm', 2),
                  ]),
                ],
              },
            ]),
          ],
        },
      ],
    },

    // ── 2. MATERIAL — a plain field, to show the two kinds side by side ──────
    {
      id: 'stickers_material',
      name: 'Material',
      nameI18n: { sv: 'Material', da: 'Materiale', no: 'Materiale' },
      group: 'product_builder',
      enabled: true,
      description: 'All four are paper. Only the surface differs.',
      descriptionI18n: {
        sv: 'Alla fyra är papper. Det är bara ytan som skiljer.',
        da: 'Alle fire er papir. Det er kun overfladen, der er forskellig.',
        no: 'Alle fire er papir. Det er bare overflaten som skiller.',
      },
      options: [
        {
          id: 'mat_matt',
          label: 'Matt paper, writable',
          labelI18n: {
            sv: 'Matt papper, skrivbart',
            da: 'Mat papir, skrivbart',
            no: 'Matt papir, skrivbart',
          },
          value: 'matt-paper',
          priceModifier: 0,
          isDefault: true,
          recommended: true,
        },
        {
          id: 'mat_recycled',
          label: 'Glossy recycled paper',
          labelI18n: {
            sv: 'Glansigt återvunnet papper',
            da: 'Blankt genbrugspapir',
            no: 'Blankt resirkulert papir',
          },
          value: 'recycled-paper',
          priceModifier: 1,
        },
        {
          id: 'mat_gloss',
          label: 'Glossy paper, for vivid design',
          labelI18n: {
            sv: 'Glansigt papper, för levande design',
            da: 'Blankt papir, til levende design',
            no: 'Blankt papir, for levende design',
          },
          value: 'gloss-paper',
          priceModifier: 1,
        },
        {
          id: 'mat_paperwise',
          label: 'Paperwise — paper from agricultural waste',
          labelI18n: {
            sv: 'Paperwise — papper av jordbruksavfall',
            da: 'Paperwise — papir af landbrugsaffald',
            no: 'Paperwise — papir av landbruksavfall',
          },
          value: 'paperwise',
          priceModifier: 2,
        },
      ],
    },

    // ── 3. PRINT ─────────────────────────────────────────────────────────────
    {
      id: 'stickers_print',
      name: 'Print option',
      nameI18n: { sv: 'Tryckalternativ', da: 'Trykmulighed', no: 'Trykkalternativ' },
      group: 'product_builder',
      enabled: true,
      options: [
        {
          id: 'print_full_colour',
          label: 'One layer, full colour',
          labelI18n: {
            sv: 'Ett lager fullfärgstryck',
            da: 'Ét lag fuldfarvetryk',
            no: 'Ett lag fullfargetrykk',
          },
          value: 'one-layer-full-colour',
          priceModifier: 0,
          isDefault: true,
        },
        {
          id: 'print_white_base',
          label: 'Full colour on a white base',
          labelI18n: {
            sv: 'Fullfärg på vit botten',
            da: 'Fuldfarve på hvid bund',
            no: 'Fullfarge på hvit bunn',
          },
          value: 'full-colour-white-base',
          priceModifier: 1,
        },
      ],
    },
  ],

  features: [
    'Cut to shape — round, square, rectangular, and oval on the roll',
    'Writable matt paper, or glossy for vivid artwork',
    'Individually cut, or wound on a roll for a dispenser',
    'Indoor use',
  ],
  featuresI18n: {
    sv: [
      'Skurna i form — rund, kvadrat, rektangel, och oval på rulle',
      'Skrivbart matt papper, eller glansigt för levande tryck',
      'Individuellt skurna, eller lindade på rulle för dispenser',
      'För inomhusbruk',
    ],
    da: [
      'Skåret i form — rund, kvadrat, rektangel, og oval på rulle',
      'Skrivbart mat papir, eller blankt til levende tryk',
      'Enkeltvis skåret, eller viklet på rulle til dispenser',
      'Til indendørs brug',
    ],
    no: [
      'Skåret i form — rund, kvadrat, rektangel, og oval på rull',
      'Skrivbart matt papir, eller blankt for levende trykk',
      'Enkeltvis skåret, eller viklet på rull for dispenser',
      'For innendørs bruk',
    ],
  },

  specs: [
    {
      label: 'Material',
      value: 'Uncoated paper, 73 g/m²',
      labelI18n: { sv: 'Material', da: 'Materiale', no: 'Materiale' },
      valueI18n: {
        sv: 'Obestruket papper, 73 g/m²',
        da: 'Ubestrøget papir, 73 g/m²',
        no: 'Ubestrøket papir, 73 g/m²',
      },
    },
    {
      label: 'Use',
      value: 'Indoor',
      labelI18n: { sv: 'Användning', da: 'Anvendelse', no: 'Bruk' },
      valueI18n: { sv: 'Inomhus', da: 'Indendørs', no: 'Innendørs' },
    },
    {
      label: 'Shapes',
      value: 'Round, square, rectangle — oval on the roll',
      labelI18n: { sv: 'Former', da: 'Former', no: 'Former' },
      valueI18n: {
        sv: 'Rund, kvadrat, rektangel — oval på rulle',
        da: 'Rund, kvadrat, rektangel — oval på rulle',
        no: 'Rund, kvadrat, rektangel — oval på rull',
      },
    },
    {
      label: 'Printing',
      value: 'Digital, single sided',
      labelI18n: { sv: 'Tryckteknik', da: 'Trykteknik', no: 'Trykketeknikk' },
      valueI18n: { sv: 'Digitalt, ensidigt', da: 'Digitalt, enkeltsidet', no: 'Digitalt, ensidig' },
    },
    {
      label: 'Corners',
      value: 'Rounded',
      labelI18n: { sv: 'Hörn', da: 'Hjørner', no: 'Hjørner' },
      valueI18n: { sv: 'Rundade', da: 'Afrundede', no: 'Avrundede' },
    },
  ],

  faq: [
    {
      q: 'What is the difference between individual stickers and a roll?',
      a: 'Individual stickers arrive cut and loose, on a backing sheet. On a roll they are wound in order, which is what you want if they are being applied one after another — at a till, on a packing bench, or from a dispenser.',
      qI18n: {
        sv: 'Vad är skillnaden mellan individuella klistermärken och rulle?',
        da: 'Hvad er forskellen på individuelle klistermærker og rulle?',
        no: 'Hva er forskjellen på individuelle klistremerker og rull?',
      },
      aI18n: {
        sv: 'Individuella klistermärken levereras skurna och lösa på ett bakstycke. På rulle lindas de i ordning, vilket är vad du vill ha om de sätts på ett i taget — i kassan, vid packbordet eller från en dispenser.',
        da: 'Individuelle klistermærker leveres skåret og løse på et bagark. På rulle vikles de i rækkefølge, hvilket er det, du vil have, hvis de sættes på ét ad gangen — ved kassen, på pakkebordet eller fra en dispenser.',
        no: 'Individuelle klistremerker leveres skåret og løse på et bakark. På rull vikles de i rekkefølge, som er det du vil ha hvis de settes på ett om gangen — i kassen, på pakkebordet eller fra en dispenser.',
      },
    },
    {
      q: 'Why does the oval shape only appear on the roll?',
      a: 'Because that is how it is cut. An oval is die-cut in line as the roll is wound; loose ovals would need their own tool. Pick "Printed on a roll" and the oval appears in the shape row.',
      qI18n: {
        sv: 'Varför finns den ovala formen bara på rulle?',
        da: 'Hvorfor findes den ovale form kun på rulle?',
        no: 'Hvorfor finnes den ovale formen bare på rull?',
      },
      aI18n: {
        sv: 'För att det är så den stansas. En oval stansas i linjen medan rullen lindas; lösa ovaler skulle kräva ett eget verktyg. Välj "Tryckt på rulle" så dyker ovalen upp i formraden.',
        da: 'Fordi det er sådan, den stanses. En oval stanses i linjen, mens rullen vikles; løse ovaler ville kræve deres eget værktøj. Vælg "Trykt på rulle", så dukker ovalen op i formrækken.',
        no: 'Fordi det er slik den stanses. En oval stanses i linjen mens rullen vikles; løse ovaler ville kreve sitt eget verktøy. Velg "Trykt på rull", så dukker ovalen opp i formraden.',
      },
    },
    {
      q: 'Can I write on them?',
      a: 'On the matt paper, yes — pen, pencil and marker all take. The glossy papers are for artwork that has to be vivid, and they resist ink.',
      qI18n: { sv: 'Går det att skriva på dem?', da: 'Kan man skrive på dem?', no: 'Går det an å skrive på dem?' },
      aI18n: {
        sv: 'På det matta pappret, ja — penna, blyerts och märkpenna fäster alla. De glansiga pappren är till för tryck som ska vara levande, och de tar inte bläck lika bra.',
        da: 'På det matte papir, ja — kuglepen, blyant og tusch tager alle. De blanke papirer er til tryk, der skal være levende, og de tager ikke blæk lige så godt.',
        no: 'På det matte papiret, ja — penn, blyant og tusj fester alle. De blanke papirene er for trykk som skal være levende, og de tar ikke blekk like godt.',
      },
    },
  ],
};
