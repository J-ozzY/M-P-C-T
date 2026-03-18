/**
 * Parses a MTG decklist format and extracts card names.
 *
 * Input format examples:
 *   1 Adorned Pouncer (HOU) 2
 *   14 Forest (EOE) 276
 *   1 Betor, Ancestor's Voice (TDC) 1 *F*
 *   1 Gemrazer (IKO) 295 #Creatures
 *
 * Extracts just the card name (e.g., "Adorned Pouncer", "Forest", etc.)
 */

export interface ParsedCard {
  quantity: number;
  name: string;
  setCode?: string;
  collectorNumber?: string;
  isFoil: boolean;
  rawLine: string;
}

export function parseDecklist(input: string): ParsedCard[] {
  const lines = input.split('\n');
  const cards: ParsedCard[] = [];
  const seenNames = new Set<string>();

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Skip empty lines and pure comment lines
    if (!line || line.startsWith('#') || line.startsWith('//')) {
      continue;
    }

    const parsed = parseLine(line);
    if (parsed && !seenNames.has(parsed.name.toLowerCase())) {
      seenNames.add(parsed.name.toLowerCase());
      cards.push(parsed);
    }
  }

  return cards;
}

function parseLine(line: string): ParsedCard | null {
  // Remove inline comments: everything after #
  let cleaned = line.replace(/#.*$/, '').trim();

  // Normalize square brackets to parentheses for set codes: [THS] → (THS)
  cleaned = cleaned.replace(/\[([A-Z0-9]+)\]/g, '($1)');

  // Detect and remove foil/etched markers: *F*, *E*
  const isFoil = /\*F\*/.test(cleaned) || /\*E\*/.test(cleaned);
  cleaned = cleaned.replace(/\s*\*[FE]\*\s*/g, '').trim();

  // Pattern: QUANTITY CARDNAME (SETCODE) COLLECTORNUMBER
  // The quantity is a number at the start
  // The set code is in parentheses
  // The collector number follows the set code
  const match = cleaned.match(
    /^(\d+)\s+(.+?)\s+\(([A-Z0-9]+)\)\s+(\S+)\s*$/
  );

  if (match) {
    return {
      quantity: parseInt(match[1], 10),
      name: match[2].trim(),
      setCode: match[3],
      collectorNumber: match[4],
      isFoil,
      rawLine: line,
    };
  }

  // Fallback: try without collector number
  // Pattern: QUANTITY CARDNAME (SETCODE)
  const match2 = cleaned.match(/^(\d+)\s+(.+?)\s+\(([A-Z0-9]+)\)\s*$/);
  if (match2) {
    return {
      quantity: parseInt(match2[1], 10),
      name: match2[2].trim(),
      setCode: match2[3],
      isFoil,
      rawLine: line,
    };
  }

  // Fallback: just quantity and name (no set info)
  // Pattern: QUANTITY CARDNAME
  const match3 = cleaned.match(/^(\d+)\s+(.+)$/);
  if (match3) {
    return {
      quantity: parseInt(match3[1], 10),
      name: match3[2].trim(),
      isFoil,
      rawLine: line,
    };
  }

  // Last resort: treat entire line as card name
  if (cleaned.length > 0) {
    return {
      quantity: 1,
      name: cleaned,
      isFoil,
      rawLine: line,
    };
  }

  return null;
}
