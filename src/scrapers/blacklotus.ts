import axios from 'axios';
import * as cheerio from 'cheerio';
import { Scraper, ScraperResult } from './types';

/**
 * BlackLotus.cz scraper using GET global search + HTML parsing with cheerio.
 *
 * GET https://www.blacklotus.cz/vyhledavani/?string={name}
 * The category URL (?search=) does NOT actually filter results.
 * The global search (/vyhledavani/?string=) works correctly.
 *
 * Shoptet-based e-commerce - results have microdata attributes.
 */
export class BlackLotusScraper implements Scraper {
  readonly shopName = 'BlackLotus.cz';

  private readonly baseUrl = 'https://www.blacklotus.cz/vyhledavani/';

  async search(cardName: string): Promise<ScraperResult> {
    const url = `${this.baseUrl}?string=${encodeURIComponent(cardName)}`;

    try {
      const response = await axios.get(url, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml',
        },
        responseType: 'text',
      });

      const html = response.data as string;
      const $ = cheerio.load(html);
      const prices: number[] = [];
      let totalStock = 0;

      // BlackLotus uses Shoptet platform with microdata.
      // Product containers: div.product > div.p[data-testid="productItem"]
      // Card name: span[data-micro="name"]
      // Price: div[data-micro="offer"] data-micro-price attribute
      // Availability: data-micro-availability attribute on offer div

      $('div.product div.p').each((_i, productEl) => {
        // Get card name
        const nameEl = $(productEl).find('span[data-micro="name"]');
        const productName = nameEl.text().trim();

        if (!productName || !isNameMatch(productName, cardName)) {
          return;
        }

        // Get price from microdata
        const offerEl = $(productEl).find('div[data-micro="offer"]');
        const priceStr = offerEl.attr('data-micro-price');
        const availability = offerEl.attr('data-micro-availability') || '';

        // Check availability
        const isInStock = availability.includes('InStock');
        if (isInStock) {
          // Only include prices from in-stock listings
          if (priceStr) {
            const price = parseFloat(priceStr);
            if (!isNaN(price) && price > 0) {
              prices.push(price);
            }
          }

          // Try to get stock count from availability-amount span
          const stockText = $(productEl)
            .find('span.availability-amount')
            .text()
            .trim();
          const stockMatch = stockText.match(/(\d+)/);
          if (stockMatch) {
            totalStock += parseInt(stockMatch[1], 10);
          } else {
            totalStock += 1; // At least 1 in stock
          }
        }
      });

      return {
        shop: this.shopName,
        cardName,
        prices,
        priceMin: prices.length > 0 ? Math.min(...prices) : null,
        priceMax: prices.length > 0 ? Math.max(...prices) : null,
        inStock: totalStock,
        currency: 'CZK',
        url,
      };
    } catch (error) {
      console.error(
        `[BlackLotus] Error searching for "${cardName}":`,
        error instanceof Error ? error.message : error
      );
      return {
        shop: this.shopName,
        cardName,
        prices: [],
        priceMin: null,
        priceMax: null,
        inStock: 0,
        currency: 'CZK',
        url,
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

  if (pName === sName) return true;
  if (pName.startsWith(sName)) return true;
  if (sName.startsWith(pName)) return true;

  return false;
}
