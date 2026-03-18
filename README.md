# MPCT - Magic: The Gathering Price Comparison Tool

Price comparison tool for Czech MTG singles shops.

## Requirements

- [Node.js](https://nodejs.org/) (v18 or higher)

## Quick Start (Windows)

1. Double-click `start.bat`
2. The app will open in your browser at `http://localhost:3000`

The script automatically installs dependencies and builds the project on first run.

## Manual Setup

```bash
npm install
npm run build
npm start
```

Then open `http://localhost:3000` in your browser.

## Usage

1. Paste a decklist into the text area (supports MTG Arena export format)
2. Click **Search Prices**
3. Wait for results - all three shops are searched in parallel for each card
4. Compare prices across shops, sort by any column, or export to CSV

Press **Stop** at any time to cancel the search.

## About

MPCT searches and compares Magic: The Gathering single card prices across three Czech online shops:

- **Najada.games** - via REST API
- **CernyRytir.cz** - via HTML scraping
- **BlackLotus.cz** - via HTML scraping

The tool is designed to run locally on your machine. It scrapes each shop's website in real time, finds the cheapest in-stock price for every card in your list, and shows a side-by-side comparison with a total deck price. Results are stored in a local SQLite database and can be exported as CSV.

Built for the Czech MTG singles market. All prices are in CZK.
