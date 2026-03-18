export interface ScraperResult {
  shop: string;
  cardName: string;
  prices: number[];       // All found prices in CZK
  priceMin: number | null;
  priceMax: number | null;
  inStock: number;        // Total number of in-stock listings
  currency: string;
  url: string;            // The search URL used
}

export interface Scraper {
  readonly shopName: string;
  search(cardName: string): Promise<ScraperResult>;
}
