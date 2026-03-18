import express, { Request, Response } from 'express';
import path from 'path';
import { parseDecklist } from './parser';
import { getLatestResults, clearAllResults, getDb, getCardImage, getCardImagesByNames } from './db';
import { ScraperManager, SearchProgress } from './scraper-manager';
import { fetchAndStoreImages, isImageFetchRunning } from './scryfall';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Scraper manager singleton
const scraperManager = new ScraperManager();
let activeManager: ScraperManager = scraperManager;

// Store SSE connections for progress updates
const sseClients: Set<Response> = new Set();

// ---- API Routes ----

// Get current results
app.get('/api/results', (_req: Request, res: Response) => {
  try {
    const results = getLatestResults();

    // Group results by card name
    const grouped: Record<
      string,
      {
        cardName: string;
        shops: Record<
          string,
          {
            priceMin: number | null;
            priceMax: number | null;
            inStock: number;
            url: string | null;
            searchedAt: string;
          }
        >;
      }
    > = {};

    for (const row of results) {
      if (!grouped[row.card_name]) {
        grouped[row.card_name] = { cardName: row.card_name, shops: {} };
      }
      grouped[row.card_name].shops[row.shop] = {
        priceMin: row.price_min,
        priceMax: row.price_max,
        inStock: row.in_stock,
        url: row.url,
        searchedAt: row.searched_at,
      };
    }

    res.json({
      success: true,
      data: Object.values(grouped),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Start a search
app.post('/api/search', (req: Request, res: Response) => {
  try {
    if (activeManager.running) {
      res.status(409).json({
        success: false,
        error: 'A search is already in progress',
      });
      return;
    }

    const { cardList, delayMs } = req.body;

    if (!cardList || typeof cardList !== 'string') {
      res.status(400).json({
        success: false,
        error: 'cardList is required and must be a string',
      });
      return;
    }

    const parsed = parseDecklist(cardList);

    if (parsed.length === 0) {
      res.status(400).json({
        success: false,
        error: 'No valid card names found in the input',
      });
      return;
    }

    const cardNames = parsed.map((c) => c.name);

    // Respond immediately
    res.json({
      success: true,
      message: `Starting search for ${cardNames.length} cards`,
      cards: cardNames,
    });

    // Create a new manager if custom delay is specified
    const manager =
      delayMs && typeof delayMs === 'number'
        ? new ScraperManager(delayMs)
        : scraperManager;
    activeManager = manager;

    // Start the search in the background
    const onProgress: (progress: SearchProgress) => void = (progress) => {
      // Broadcast to all SSE clients
      const data = JSON.stringify(progress);
      for (const client of sseClients) {
        client.write(`data: ${data}\n\n`);
      }
    };

    manager.searchAll(cardNames, onProgress).catch((err) => {
      console.error('Search failed:', err);
      const errorData = JSON.stringify({
        type: 'error',
        message: err instanceof Error ? err.message : 'Search failed',
      });
      for (const client of sseClients) {
        client.write(`data: ${errorData}\n\n`);
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// SSE endpoint for progress updates
app.get('/api/progress', (_req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  // Send initial connection message
  res.write(
    `data: ${JSON.stringify({ type: 'connected', running: activeManager.running })}\n\n`
  );

  sseClients.add(res);

  // Remove client on disconnect
  _req.on('close', () => {
    sseClients.delete(res);
  });
});

// Stop current search
app.post('/api/stop', (_req: Request, res: Response) => {
  activeManager.stop();
  res.json({ success: true, message: 'Stop signal sent' });
});

// Clear all results
app.post('/api/clear', (_req: Request, res: Response) => {
  try {
    clearAllResults();
    res.json({ success: true, message: 'All results cleared' });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Get cached image for a single card
app.get('/api/card-image/:cardName', (req: Request, res: Response) => {
  try {
    const rawParam = req.params.cardName;
    const cardName = decodeURIComponent(Array.isArray(rawParam) ? rawParam[0] : rawParam);
    const image = getCardImage(cardName);

    res.json({
      success: true,
      cardName,
      imageUrl: image?.image_url || null,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Get cached images for multiple cards (bulk)
app.post('/api/card-images', (req: Request, res: Response) => {
  try {
    const { cardNames } = req.body;

    if (!Array.isArray(cardNames)) {
      res.status(400).json({
        success: false,
        error: 'cardNames must be an array of strings',
      });
      return;
    }

    const images = getCardImagesByNames(cardNames);
    const imageMap: Record<string, string> = {};
    for (const img of images) {
      if (img.image_url) {
        imageMap[img.card_name] = img.image_url;
      }
    }

    res.json({ success: true, images: imageMap });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Trigger background image fetching for a list of cards
app.post('/api/fetch-images', (req: Request, res: Response) => {
  try {
    const { cardNames } = req.body;

    if (!Array.isArray(cardNames)) {
      res.status(400).json({
        success: false,
        error: 'cardNames must be an array of strings',
      });
      return;
    }

    if (isImageFetchRunning()) {
      res.json({
        success: true,
        message: 'Image fetch already in progress',
      });
      return;
    }

    // Start fetching in the background
    fetchAndStoreImages(cardNames).catch((err) => {
      console.error('Background image fetch failed:', err);
    });

    res.json({
      success: true,
      message: `Started fetching images for ${cardNames.length} cards`,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Check status
app.get('/api/status', (_req: Request, res: Response) => {
  res.json({
    success: true,
    running: activeManager.running,
  });
});

// Initialize DB on startup
getDb();

app.listen(PORT, () => {
  console.log(`MPCT server running at http://localhost:${PORT}`);
  console.log('Open in your browser to start comparing card prices.');
});
