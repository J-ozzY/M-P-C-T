import axios from 'axios';
import { Scraper, ScraperResult } from './types';

/**
 * Najada.games scraper using their public REST API at wizardshop.cz.
 *
 * GET https://wizardshop.cz/api/v1/najada2/catalog/mtg-singles/?q={name}
 * Returns JSON with products and their articles (purchasable variants).
 */

interface NajadaArticle {
  effective_price_czk: number;
  total_availability: number;
  condition: string;
  language_code: string;
  additional_properties: {
    is_foil: boolean;
  };
}

interface NajadaProduct {
  name: string;
  expansion: {
    localized_name: string;
    short_code: string;
  };
  articles: NajadaArticle[];
}

interface NajadaResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: NajadaProduct[];
}

export class NajadaScraper implements Scraper {
  readonly shopName = 'Najada.games';

  private readonly baseUrl =
    'https://wizardshop.cz/api/v1/najada2/catalog/mtg-singles/';

  async search(cardName: string): Promise<ScraperResult> {
    const url = `${this.baseUrl}?q=${encodeURIComponent(cardName)}&limit=50`;

    try {
      const response = await axios.get<NajadaResponse>(url, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        },
      });

      const data = response.data;
      const prices: number[] = [];
      let totalStock = 0;

      for (const product of data.results) {
        // Match by name: the product name should match or contain the search term
        if (!isNameMatch(product.name, cardName)) {
          continue;
        }

        for (const article of product.articles) {
          if (article.total_availability > 0) {
            prices.push(article.effective_price_czk);
            totalStock += article.total_availability;
          }
        }
      }

      return {
        shop: this.shopName,
        cardName,
        prices,
        priceMin: prices.length > 0 ? Math.min(...prices) : null,
        priceMax: prices.length > 0 ? Math.max(...prices) : null,
        inStock: totalStock,
        currency: 'CZK',
        url: `https://www.najada.games/en/single-cards/magic-the-gathering/sell/search?q=${encodeURIComponent(cardName)}`,
      };
    } catch (error) {
      console.error(`[Najada] Error searching for "${cardName}":`, error instanceof Error ? error.message : error);
      return {
        shop: this.shopName,
        cardName,
        prices: [],
        priceMin: null,
        priceMax: null,
        inStock: 0,
        currency: 'CZK',
        url: url,
      };
    }
  }
}

/** Normalize apostrophe-like characters to ASCII apostrophe for comparison. */
function normalizeApostrophes(str: string): string {
  return str.replace(/[\u2018\u2019\u00b4`]/g, "'");
}

function isNameMatch(productName: string, searchName: string): boolean {
  const pName = normalizeApostrophes(productName.toLowerCase().trim());
  const sName = normalizeApostrophes(searchName.toLowerCase().trim());

  // Exact match
  if (pName === sName) return true;

  // Product name starts with search name (handles editions adding suffixes)
  if (pName.startsWith(sName)) return true;

  // Search name starts with product name
  if (sName.startsWith(pName)) return true;

  return false;
}
