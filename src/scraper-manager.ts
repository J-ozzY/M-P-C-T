import { Scraper, ScraperResult } from './scrapers/types';
import { NajadaScraper } from './scrapers/najada';
import { CernyRytirScraper } from './scrapers/cerny-rytir';
import { BlackLotusScraper } from './scrapers/blacklotus';
import { getOrCreateCard, saveSearchResult } from './db';

export interface SearchProgress {
  type: 'progress' | 'result' | 'done' | 'error';
  cardName?: string;
  shop?: string;
  current?: number;
  total?: number;
  totalShops?: number;
  currentShop?: number;
  result?: ScraperResult;
  message?: string;
}

export type ProgressCallback = (progress: SearchProgress) => void;

const DEFAULT_DELAY_MS = 2000; // 2 seconds between cards (shops run in parallel)

export class ScraperManager {
  private scrapers: Scraper[];
  private delayMs: number;
  private isRunning = false;
  private shouldStop = false;
  private sleepResolve: (() => void) | null = null;

  constructor(delayMs: number = DEFAULT_DELAY_MS) {
    this.scrapers = [
      new NajadaScraper(),
      new CernyRytirScraper(),
      new BlackLotusScraper(),
    ];
    this.delayMs = delayMs;
  }

  get running(): boolean {
    return this.isRunning;
  }

  stop(): void {
    this.shouldStop = true;
    if (this.sleepResolve) {
      this.sleepResolve();
      this.sleepResolve = null;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.sleepResolve = resolve;
      setTimeout(() => {
        this.sleepResolve = null;
        resolve();
      }, ms);
    });
  }

  async searchAll(
    cardNames: string[],
    onProgress?: ProgressCallback
  ): Promise<void> {
    if (this.isRunning) {
      throw new Error('A search is already in progress');
    }

    this.isRunning = true;
    this.shouldStop = false;
    const totalCards = cardNames.length;
    const totalShops = this.scrapers.length;

    try {
      for (let i = 0; i < totalCards; i++) {
        if (this.shouldStop) {
          onProgress?.({
            type: 'done',
            message: 'Search stopped by user',
          });
          return;
        }

        const cardName = cardNames[i];

        // Notify that we're starting this card (all shops in parallel)
        onProgress?.({
          type: 'progress',
          cardName,
          current: i + 1,
          total: totalCards,
          totalShops,
        });

        // Search all shops in parallel for this card
        await Promise.all(
          this.scrapers.map(async (scraper) => {
            try {
              const result = await scraper.search(cardName);

              // Save to database
              const cardId = getOrCreateCard(cardName);
              saveSearchResult(
                cardId,
                result.shop,
                result.priceMin,
                result.priceMax,
                result.inStock,
                result.url,
                result.currency
              );

              onProgress?.({
                type: 'result',
                cardName,
                shop: scraper.shopName,
                result,
                current: i + 1,
                total: totalCards,
              });
            } catch (error) {
              console.error(
                `Error searching ${scraper.shopName} for "${cardName}":`,
                error
              );
              onProgress?.({
                type: 'error',
                cardName,
                shop: scraper.shopName,
                message:
                  error instanceof Error ? error.message : 'Unknown error',
                current: i + 1,
                total: totalCards,
              });
            }
          })
        );

        // Check stop flag after parallel scraping completes
        if (this.shouldStop) {
          onProgress?.({
            type: 'done',
            message: 'Search stopped by user',
          });
          return;
        }

        // Rate limiting delay between cards
        if (i < totalCards - 1) {
          await this.sleep(this.delayMs);
        }
      }

      onProgress?.({
        type: 'done',
        message: `Search complete. Searched ${totalCards} cards across ${totalShops} shops.`,
      });
    } finally {
      this.isRunning = false;
      this.shouldStop = false;
    }
  }
}
