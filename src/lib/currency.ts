export type CurrencyCode = 'SEK' | 'DKK' | 'EUR' | 'NOK';

export interface CurrencyInfo {
  code: CurrencyCode;
  symbol: string;
  name: string;
  rateFromSEK: number; // Multiply SEK by this rate to get target currency amount
  flag: string;
  symbolPosition: 'before' | 'after';
}

export const DEFAULT_CURRENCIES: Record<CurrencyCode, CurrencyInfo> = {
  SEK: {
    code: 'SEK',
    symbol: 'SEK',
    name: 'Swedish Krona',
    rateFromSEK: 1.0,
    flag: '🇸🇪',
    symbolPosition: 'after',
  },
  DKK: {
    code: 'DKK',
    symbol: 'DKK',
    name: 'Danish Krone',
    rateFromSEK: 0.65,
    flag: '🇩🇰',
    symbolPosition: 'after',
  },
  EUR: {
    code: 'EUR',
    symbol: '€',
    name: 'Euro',
    rateFromSEK: 0.088,
    flag: '🇪🇺',
    symbolPosition: 'before',
  },
  NOK: {
    code: 'NOK',
    symbol: 'NOK',
    name: 'Norwegian Krone',
    rateFromSEK: 1.02,
    flag: '🇳🇴',
    symbolPosition: 'after',
  },
};

/**
 * Converts a price from SEK base currency to target currency using exchange rates
 */
export function convertFromSEK(
  amountInSEK: number,
  targetCurrency: CurrencyCode,
  currencies: Record<CurrencyCode, CurrencyInfo> = DEFAULT_CURRENCIES
): number {
  const num = Number(amountInSEK) || 0;
  const info = currencies[targetCurrency] || DEFAULT_CURRENCIES.SEK;
  const rate = info.rateFromSEK || 1.0;
  return Math.round(num * rate * 100) / 100;
}

/**
 * Formats a converted amount with the appropriate currency symbol
 */
export function formatCurrencyValue(
  convertedAmount: number,
  currencyCode: CurrencyCode,
  currencies: Record<CurrencyCode, CurrencyInfo> = DEFAULT_CURRENCIES
): string {
  const info = currencies[currencyCode] || DEFAULT_CURRENCIES.SEK;
  // 'sv-SE', NOT undefined.
  //
  // `toLocaleString(undefined, …)` means "use the machine's locale", and this
  // formats MONEY. On an Arabic-locale machine — the owner's — it renders
  // Arabic-Indic digits, so a price came out as ١١ ٥٦١,٢٥ instead of
  // 11 561,25. A shop's prices must look identical to every visitor, and the
  // shop is Swedish: thin space for thousands, comma for decimals.
  const formattedNumber = convertedAmount.toLocaleString('sv-SE', {
    minimumFractionDigits: convertedAmount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });

  if (info.symbolPosition === 'before') {
    return `${info.symbol}${formattedNumber}`;
  }
  return `${formattedNumber} ${info.symbol}`;
}
