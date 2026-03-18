import axios from 'axios';
import { saveCardImage, getCardImage } from './db';

const SCRYFALL_API_BASE = 'https://api.scryfall.com';
const IMAGE_FETCH_DELAY_MS = 2000;

const scryfallClient = axios.create({
  baseURL: SCRYFALL_API_BASE,
  timeout: 15000,
  headers: {
    'User-Agent': 'MPCT/1.0',
    Accept: 'application/json;q=0.9,*/*;q=0.8',
  },
});

interface ScryfallImageUris {
  small?: string;
  normal?: string;
  large?: string;
  png?: string;
  art_crop?: string;
  border_crop?: string;
}

interface ScryfallCardFace {
  image_uris?: ScryfallImageUris;
}

interface ScryfallCard {
  image_uris?: ScryfallImageUris;
  card_faces?: ScryfallCardFace[];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get the normal image URL from a Scryfall card object.
 * Handles both single-face and multi-face cards.
 */
function getNormalImageUrl(card: ScryfallCard): string | null {
  // Single-face cards have image_uris at the top level
  if (card.image_uris?.normal) {
    return card.image_uris.normal;
  }

  // Multi-face cards (transform, mdfc, etc.) have image_uris on card_faces
  if (card.card_faces && card.card_faces.length > 0) {
    const frontFace = card.card_faces[0];
    if (frontFace.image_uris?.normal) {
      return frontFace.image_uris.normal;
    }
  }

  return null;
}

/**
 * Fetch a single card's image URL from Scryfall and store it in the DB.
 * Returns true if successful, false otherwise.
 */
async function fetchSingleCardImage(cardName: string): Promise<boolean> {
  try {
    // Get card data from Scryfall
    const response = await scryfallClient.get<ScryfallCard>('/cards/named', {
      params: { exact: cardName },
    });

    const imageUrl = getNormalImageUrl(response.data);
    if (!imageUrl) {
      console.warn(`No normal image URL found for card: ${cardName}`);
      return false;
    }

    // Save URL to DB
    saveCardImage(cardName, imageUrl);

    return true;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      console.warn(`Card not found on Scryfall: ${cardName}`);
    } else {
      console.error(
        `Failed to fetch image for "${cardName}":`,
        error instanceof Error ? error.message : error
      );
    }
    return false;
  }
}

// Track whether a background fetch is currently running
let isFetching = false;

/**
 * Fetch and store images for a list of card names.
 * Skips cards that already have cached images.
 * Applies a 2000ms delay between Scryfall API calls.
 */
export async function fetchAndStoreImages(
  cardNames: string[]
): Promise<{ fetched: number; skipped: number; failed: number }> {
  if (isFetching) {
    return { fetched: 0, skipped: cardNames.length, failed: 0 };
  }

  isFetching = true;
  let fetched = 0;
  let skipped = 0;
  let failed = 0;

  try {
    for (let i = 0; i < cardNames.length; i++) {
      const cardName = cardNames[i];

      // Check if already cached
      const existing = getCardImage(cardName);
      if (existing && existing.image_url) {
        skipped++;
        continue;
      }

      // Add delay before API call (except for the first one)
      if (fetched > 0 || failed > 0) {
        await delay(IMAGE_FETCH_DELAY_MS);
      }

      const success = await fetchSingleCardImage(cardName);
      if (success) {
        fetched++;
      } else {
        failed++;
      }
    }
  } finally {
    isFetching = false;
  }

  console.log(
    `Scryfall image fetch complete: ${fetched} fetched, ${skipped} cached, ${failed} failed`
  );

  return { fetched, skipped, failed };
}

export function isImageFetchRunning(): boolean {
  return isFetching;
}
