import axios from 'axios';
import * as cheerio from 'cheerio';
import { Scraper, ScraperResult } from './types';

/**
 * CernyRytir.cz scraper using POST form submission + HTML parsing.
 *
 * POST https://cernyrytir.cz/index.php3?akce=3
 * Form data: jmenokarty={name}, edice_magic=libovolna, rarita=A, etc.
 * Returns HTML table with card listings.
 *
 * HTML structure: results are in <table class='kusovkytext'>.
 * Each card is a group of 3 consecutive <tr> rows (image cell has rowspan='3'):
 *   Row 1: Card image (rowspan=3) + Card name (bold) + Mana cost
 *   Row 2: Set name (with set icon) + Card type
 *   Row 3: Rarity + Stock count (bold, "N ks") + Price (bold, "N Kč") + Action
 *
 * The page uses windows-1250 encoding (not UTF-8).
 */
export class CernyRytirScraper implements Scraper {
  readonly shopName = 'CernyRytir.cz';

  private readonly searchUrl = 'https://cernyrytir.cz/index.php3?akce=3';

  async search(cardName: string): Promise<ScraperResult> {
    try {
      // Build form data for POST request
      const formData = new URLSearchParams();
      formData.append('jmenokarty', cardName);
      formData.append('edice_magic', 'libovolna');
      formData.append('rarita', 'A');          // All rarities
      formData.append('foil', 'A');            // All (foil + non-foil)
      formData.append('triditpodle', 'cpigy'); // Sort by price
      formData.append('submit', 'Vyhledej');

      // Request as arraybuffer so we can decode from windows-1250
      const response = await axios.post(this.searchUrl, formData.toString(), {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'text/html,application/xhtml+xml',
        },
        responseType: 'arraybuffer',
      });

      // Decode from windows-1250 to proper Unicode
      const decoder = new TextDecoder('windows-1250');
      const html = decoder.decode(response.data as ArrayBuffer);
      const $ = cheerio.load(html);
      const prices: number[] = [];
      let totalStock = 0;

      // Card results are in <table class='kusovkytext'>.
      // Each card spans 3 <tr> rows. The first row of each group has a <td>
      // with rowspan='3' (the card image). We use that to identify group starts.
      const resultTable = $("table.kusovkytext");
      const rows = resultTable.find('tr');

      // Walk through rows, grouping by rowspan='3' markers
      let i = 0;
      while (i < rows.length) {
        const row1 = $(rows[i]);

        // Check if this row starts a card group (has a td with rowspan='3')
        const hasRowspan = row1.find('td[rowspan="3"]').length > 0;
        if (!hasRowspan) {
          i++;
          continue;
        }

        // We need rows i, i+1, i+2 for this card group
        if (i + 2 >= rows.length) break;

        const row3 = $(rows[i + 2]);

        // Extract card name from row 1: first bold font element
        const boldElements = row1.find('font[style*="font-weight"]');
        let cardNameText = '';
        if (boldElements.length > 0) {
          cardNameText = $(boldElements[0]).text().trim();
        }

        // Check if card name matches our search
        if (!cardNameText || !isNameMatch(cardNameText, cardName)) {
          i += 3;
          continue;
        }

        // Extract stock and price from row 3.
        // Row 3 has bold elements: stock count ("N ks") and price ("N Kč").
        // The bold elements in row 3 in order: stock, price
        const row3Bolds = row3.find('font[style*="font-weight"]');
        let stockCount = 0;
        let price = 0;

        row3Bolds.each((_j, el) => {
          const text = $(el).text().trim();
          // Match stock: "N ks" (with possible &nbsp; = \u00a0)
          const stockMatch = text.match(/(\d+)[\s\u00a0]*ks/);
          if (stockMatch) {
            stockCount = parseInt(stockMatch[1], 10);
            return;
          }
          // Match price: "N Kč" (with possible &nbsp; = \u00a0)
          const priceMatch = text.match(/(\d+)[\s\u00a0]*K[čc]/i);
          if (priceMatch) {
            price = parseInt(priceMatch[1], 10);
          }
        });

        if (price > 0 && stockCount > 0) {
          prices.push(price);
        }
        totalStock += stockCount;

        i += 3; // Move to next card group
      }

      return {
        shop: this.shopName,
        cardName,
        prices,
        priceMin: prices.length > 0 ? Math.min(...prices) : null,
        priceMax: prices.length > 0 ? Math.max(...prices) : null,
        inStock: totalStock,
        currency: 'CZK',
        url: this.searchUrl,
      };
    } catch (error) {
      console.error(
        `[CernyRytir] Error searching for "${cardName}":`,
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
        url: this.searchUrl,
      };
    }
  }
}

/** Normalize apostrophe-like characters to ASCII apostrophe for comparison. */
function normalizeApostrophes(str: string): string {
  return str.replace(/[\u2018\u2019\u00b4`]/g, "'");
}

function isNameMatch(productName: string, searchName: string): boolean {
  let pName = normalizeApostrophes(productName.toLowerCase().trim());
  const sName = normalizeApostrophes(searchName.toLowerCase().trim());

  // Strip known suffixes from product name (e.g. "Card Name - foil")
  pName = pName.replace(/\s*-\s*(foil|etched)\s*$/i, '');

  if (pName === sName) return true;
  if (pName.startsWith(sName)) return true;
  if (sName.startsWith(pName)) return true;

  return false;
}
