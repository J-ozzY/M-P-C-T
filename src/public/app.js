// MPCT - Client-side application logic
(function () {
  'use strict';

  // ---- DOM Elements ----
  const cardListInput = document.getElementById('cardListInput');
  const searchBtn = document.getElementById('searchBtn');
  const stopBtn = document.getElementById('stopBtn');
  const clearBtn = document.getElementById('clearBtn');
  const progressSection = document.getElementById('progressSection');
  const progressBar = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');
  const resultsBody = document.getElementById('resultsBody');
  const resultCount = document.getElementById('resultCount');
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const totalBestPrice = document.getElementById('totalBestPrice');
  const stockWarning = document.getElementById('stockWarning');

  // ---- State ----
  let currentResults = [];
  let sortColumn = 'name';
  let sortDirection = 'asc';
  let eventSource = null;
  let cardImageCache = {};     // { cardName: scryfallImageUrl }
  let pendingImageFetches = {}; // { cardName: true } - tracks in-flight requests

  // ---- Shop display names ----
  const SHOPS = ['Najada.games', 'CernyRytir.cz', 'BlackLotus.cz'];

  // ---- Theme Toggle ----
  var themeToggle = document.getElementById('themeToggle');

  function isDarkMode() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  }

  function updateThemeToggle() {
    themeToggle.checked = isDarkMode();
  }

  function toggleTheme() {
    if (themeToggle.checked) {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('mpct-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('mpct-theme', 'light');
    }
  }

  // ---- Initialize ----
  function init() {
    // Theme toggle
    themeToggle.addEventListener('change', toggleTheme);
    updateThemeToggle();

    searchBtn.addEventListener('click', startSearch);
    stopBtn.addEventListener('click', stopSearch);
    clearBtn.addEventListener('click', clearResults);
    exportCsvBtn.addEventListener('click', exportCsv);

    // Sortable column headers
    document.querySelectorAll('th.sortable').forEach(function (th) {
      th.addEventListener('click', function () {
        var col = th.getAttribute('data-sort');
        if (sortColumn === col) {
          sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          sortColumn = col;
          sortDirection = 'asc';
        }
        renderResults();
      });
    });

    // Create card image preview element
    initCardPreview();

    // Load existing results on page load
    loadResults();
    connectSSE();
  }

  // ---- SSE Connection ----
  function connectSSE() {
    if (eventSource) {
      eventSource.close();
    }

    eventSource = new EventSource('/api/progress');

    eventSource.onmessage = function (event) {
      var data = JSON.parse(event.data);
      handleProgress(data);
    };

    eventSource.onerror = function () {
      // Reconnect after delay
      setTimeout(function () {
        connectSSE();
      }, 3000);
    };
  }

  // ---- Handle Progress Events ----
  function handleProgress(data) {
    switch (data.type) {
      case 'connected':
        if (data.running) {
          showProgress();
          searchBtn.disabled = true;
          stopBtn.disabled = false;
        }
        break;

      case 'progress':
        showProgress();
        searchBtn.disabled = true;
        stopBtn.disabled = false;
        var pct = ((data.current - 1) / data.total) * 100;
        progressBar.style.width = Math.min(pct, 100) + '%';
        progressText.textContent =
          'Searching: "' + data.cardName + '" across all shops' +
          ' (' + data.current + '/' + data.total + ')';
        break;

      case 'result':
        // Refresh results table after each card completes from last shop
        loadResults();
        break;

      case 'done':
        hideProgress();
        searchBtn.disabled = false;
        stopBtn.disabled = true;
        progressBar.style.width = '100%';
        progressText.textContent = data.message || 'Done!';
        loadResults();
        break;

      case 'error':
        progressText.textContent =
          'Error: ' + (data.message || 'Unknown error') +
          (data.cardName ? ' (card: ' + data.cardName + ')' : '');
        break;
    }
  }

  function showProgress() {
    progressSection.classList.remove('hidden');
  }

  function hideProgress() {
    // Keep visible briefly so user can see completion
    setTimeout(function () {
      progressSection.classList.add('hidden');
      progressBar.style.width = '0%';
    }, 3000);
  }

  // ---- API Calls ----
  async function startSearch() {
    var cardList = cardListInput.value.trim();
    if (!cardList) {
      alert('Please paste a card list first.');
      return;
    }

    var delayMs = 2500;

    searchBtn.disabled = true;
    stopBtn.disabled = false;
    showProgress();
    progressBar.style.width = '0%';
    progressText.textContent = 'Starting search...';

    try {
      var response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardList: cardList, delayMs: delayMs }),
      });

      var result = await response.json();

      if (!result.success) {
        alert('Error: ' + result.error);
        searchBtn.disabled = false;
        stopBtn.disabled = true;
        hideProgress();
      }
    } catch (err) {
      alert('Failed to start search: ' + err.message);
      searchBtn.disabled = false;
      stopBtn.disabled = true;
      hideProgress();
    }
  }

  async function stopSearch() {
    try {
      await fetch('/api/stop', { method: 'POST' });
      stopBtn.disabled = true;
      progressText.textContent = 'Stopping...';
    } catch (err) {
      console.error('Failed to stop:', err);
    }
  }

  async function clearResults() {
    if (!confirm('Clear all saved results?')) return;

    try {
      await fetch('/api/clear', { method: 'POST' });
      currentResults = [];
      cardImageCache = {};
      pendingImageFetches = {};
      renderResults();
    } catch (err) {
      alert('Failed to clear: ' + err.message);
    }
  }

  async function loadResults() {
    try {
      var response = await fetch('/api/results');
      var result = await response.json();

      if (result.success) {
        currentResults = result.data;
        renderResults();

        // Trigger background image fetching and load cached images
        if (currentResults.length > 0) {
          var cardNames = currentResults.map(function (c) { return c.cardName; });
          triggerImageFetch(cardNames);
          loadCachedImages(cardNames);
        }
      }
    } catch (err) {
      console.error('Failed to load results:', err);
    }
  }

  // ---- Render Results Table ----
  function renderResults() {
    if (currentResults.length === 0) {
      resultsBody.innerHTML =
        '<tr class="empty-row"><td colspan="5">No results yet. Paste a card list and click "Search Prices".</td></tr>';
      resultCount.textContent = '';
      totalBestPrice.textContent = '';
      stockWarning.textContent = '';
      exportCsvBtn.disabled = true;
      return;
    }

    exportCsvBtn.disabled = false;
    resultCount.textContent = currentResults.length + ' cards';

    // Sort
    var sorted = currentResults.slice().sort(function (a, b) {
      var valA, valB;

      switch (sortColumn) {
        case 'name':
          valA = a.cardName.toLowerCase();
          valB = b.cardName.toLowerCase();
          return sortDirection === 'asc'
            ? valA.localeCompare(valB)
            : valB.localeCompare(valA);

        case 'najada':
          valA = getMinPrice(a, 'Najada.games');
          valB = getMinPrice(b, 'Najada.games');
          break;

        case 'cerny':
          valA = getMinPrice(a, 'CernyRytir.cz');
          valB = getMinPrice(b, 'CernyRytir.cz');
          break;

        case 'blacklotus':
          valA = getMinPrice(a, 'BlackLotus.cz');
          valB = getMinPrice(b, 'BlackLotus.cz');
          break;

        case 'best':
          valA = getBestPrice(a);
          valB = getBestPrice(b);
          break;

        default:
          return 0;
      }

      if (valA === Infinity && valB === Infinity) return 0;
      if (valA === Infinity) return 1;
      if (valB === Infinity) return -1;
      return sortDirection === 'asc' ? valA - valB : valB - valA;
    });

    // Update sort icons
    document.querySelectorAll('th.sortable .sort-icon').forEach(function (icon) {
      icon.textContent = '';
    });
    var activeHeader = document.querySelector(
      'th[data-sort="' + sortColumn + '"] .sort-icon'
    );
    if (activeHeader) {
      activeHeader.textContent = sortDirection === 'asc' ? ' ▲' : ' ▼';
    }

    // Build rows
    var html = '';
    for (var i = 0; i < sorted.length; i++) {
      var card = sorted[i];
      var bestPrice = getBestPrice(card);
      var bestShop = getBestShop(card);

      html += '<tr>';
      html += '<td class="card-name" data-card-name="' + escapeAttr(card.cardName) + '">' + escapeHtml(card.cardName) + '</td>';

      for (var j = 0; j < SHOPS.length; j++) {
        var shop = SHOPS[j];
        var shopData = card.shops[shop];
        var isBest = shop === bestShop && bestPrice !== Infinity;

        if (shopData && shopData.priceMin !== null) {
          var priceText = formatPrice(shopData.priceMin, shopData.priceMax);
          var cellClass = 'price-cell';
          if (isBest && shopData.inStock > 0) cellClass += ' best-price';
          if (shopData.inStock > 0) cellClass += ' in-stock';
          else cellClass += ' out-of-stock';

          var stockBadge = '';
          if (shopData.inStock > 0) {
            stockBadge = '<span class="stock-badge badge-in">' + shopData.inStock + ' in stock</span>';
          } else {
            stockBadge = '<span class="stock-badge badge-out">Out of stock</span>';
          }

          if (shopData.url) {
            html +=
              '<td class="' + cellClass + '">' +
              '<a href="' + escapeHtml(shopData.url) + '" target="_blank" class="price-link">' +
              priceText +
              '</a>' + stockBadge + '</td>';
          } else {
            html += '<td class="' + cellClass + '"><span class="price-text">' + priceText + '</span>' + stockBadge + '</td>';
          }
        } else {
          html += '<td class="price-cell no-data">&mdash;</td>';
        }
      }

      // Best price column
      if (bestPrice !== Infinity) {
        html +=
          '<td class="price-cell best-price">' +
          formatSinglePrice(bestPrice) + ' (' + bestShop + ')</td>';
      } else {
        html += '<td class="price-cell no-data">&mdash;</td>';
      }

      html += '</tr>';
    }

    resultsBody.innerHTML = html;

    // Calculate and display total best price
    var totalBest = 0;
    var cardsWithPrice = 0;
    for (var k = 0; k < currentResults.length; k++) {
      var bp = getBestPrice(currentResults[k]);
      if (bp !== Infinity) {
        totalBest += bp;
        cardsWithPrice++;
      }
    }
    totalBestPrice.textContent = cardsWithPrice > 0
      ? 'Total Best Price: ' + formatSinglePrice(totalBest)
      : '';

    // Calculate not found / out of stock counts
    var notFound = 0;
    var outOfStock = 0;
    for (var m = 0; m < currentResults.length; m++) {
      var c = currentResults[m];
      var hasData = false;
      var hasStock = false;
      for (var n = 0; n < SHOPS.length; n++) {
        var sd = c.shops[SHOPS[n]];
        if (sd && sd.priceMin !== null) {
          hasData = true;
          if (sd.inStock > 0) hasStock = true;
        }
      }
      if (!hasData) notFound++;
      else if (!hasStock) outOfStock++;
    }

    var warnings = [];
    if (notFound > 0) warnings.push(notFound + ' not found');
    if (outOfStock > 0) warnings.push(outOfStock + ' out of stock');
    stockWarning.textContent = warnings.length > 0 ? warnings.join(', ') : '';
  }

  // ---- Helper Functions ----
  function getMinPrice(card, shop) {
    var shopData = card.shops[shop];
    if (shopData && shopData.priceMin !== null) return shopData.priceMin;
    return Infinity;
  }

  function getMinPriceInStock(card, shop) {
    var shopData = card.shops[shop];
    if (shopData && shopData.priceMin !== null && shopData.inStock > 0) return shopData.priceMin;
    return Infinity;
  }

  function getBestPrice(card) {
    var best = Infinity;
    for (var i = 0; i < SHOPS.length; i++) {
      var p = getMinPriceInStock(card, SHOPS[i]);
      if (p < best) best = p;
    }
    return best;
  }

  function getBestShop(card) {
    var best = Infinity;
    var bestShop = '';
    for (var i = 0; i < SHOPS.length; i++) {
      var p = getMinPriceInStock(card, SHOPS[i]);
      if (p < best) {
        best = p;
        bestShop = SHOPS[i];
      }
    }
    return bestShop;
  }

  function formatPrice(min, max) {
    if (min === null) return '—';
    if (max === null || min === max) return formatSinglePrice(min);
    return formatSinglePrice(min) + ' – ' + formatSinglePrice(max);
  }

  function formatSinglePrice(price) {
    if (price === null || price === undefined) return '—';
    // Format with locale-appropriate number and Kc suffix
    return Math.round(price * 100) / 100 + ' Kč';
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // ---- Card Image Preview ----
  var cardPreviewEl = null;
  var cardPreviewImg = null;
  var cardPreviewLoading = null;
  var previewHideTimer = null;

  function initCardPreview() {
    // Create the floating preview element
    cardPreviewEl = document.createElement('div');
    cardPreviewEl.id = 'cardPreview';
    cardPreviewEl.className = 'card-preview';

    cardPreviewImg = document.createElement('img');
    cardPreviewImg.className = 'card-preview-img';
    cardPreviewImg.alt = '';

    cardPreviewLoading = document.createElement('div');
    cardPreviewLoading.className = 'card-preview-loading';
    cardPreviewLoading.textContent = 'Loading...';

    cardPreviewEl.appendChild(cardPreviewImg);
    cardPreviewEl.appendChild(cardPreviewLoading);
    document.body.appendChild(cardPreviewEl);

    // Event delegation on the results table body
    resultsBody.addEventListener('mouseenter', handleCardNameEnter, true);
    resultsBody.addEventListener('mouseleave', handleCardNameLeave, true);
    resultsBody.addEventListener('mousemove', handleCardNameMove, true);
  }

  function handleCardNameEnter(e) {
    var cell = e.target.closest('td.card-name');
    if (!cell) return;

    clearTimeout(previewHideTimer);
    var cardName = cell.getAttribute('data-card-name');
    if (!cardName) return;

    showCardPreview(cardName, cell);
  }

  function handleCardNameLeave(e) {
    var cell = e.target.closest('td.card-name');
    if (!cell) return;

    // Small delay before hiding so the preview doesn't flicker
    previewHideTimer = setTimeout(function () {
      hideCardPreview();
    }, 100);
  }

  function handleCardNameMove(e) {
    var cell = e.target.closest('td.card-name');
    if (!cell) return;

    if (cardPreviewEl.classList.contains('visible')) {
      positionPreview(cell);
    }
  }

  function showCardPreview(cardName, cell) {
    // Check cache first
    if (cardImageCache[cardName]) {
      cardPreviewImg.src = cardImageCache[cardName];
      cardPreviewImg.style.display = 'block';
      cardPreviewLoading.style.display = 'none';
      cardPreviewEl.classList.add('visible');
      positionPreview(cell);
      return;
    }

    // Show loading state
    cardPreviewImg.style.display = 'none';
    cardPreviewLoading.style.display = 'block';
    cardPreviewEl.classList.add('visible');
    positionPreview(cell);

    // Fetch image from API if not already in-flight
    if (!pendingImageFetches[cardName]) {
      pendingImageFetches[cardName] = true;
      fetchCardImage(cardName).then(function (imageData) {
        delete pendingImageFetches[cardName];
        if (imageData) {
          cardImageCache[cardName] = imageData;
          // Update preview if still hovering this card
          var currentCardName = cardPreviewEl.getAttribute('data-current-card');
          if (currentCardName === cardName && cardPreviewEl.classList.contains('visible')) {
            cardPreviewImg.src = imageData;
            cardPreviewImg.style.display = 'block';
            cardPreviewLoading.style.display = 'none';
          }
        } else {
          // No image available - hide if still showing loading for this card
          var currentCardName = cardPreviewEl.getAttribute('data-current-card');
          if (currentCardName === cardName && cardPreviewEl.classList.contains('visible')) {
            hideCardPreview();
          }
        }
      });
    }

    cardPreviewEl.setAttribute('data-current-card', cardName);
  }

  function hideCardPreview() {
    cardPreviewEl.classList.remove('visible');
    cardPreviewEl.removeAttribute('data-current-card');
  }

  function positionPreview(cell) {
    var rect = cell.getBoundingClientRect();
    var previewWidth = 232;
    var previewHeight = 323;
    var gap = 8;

    // Position to the left of the card name cell
    var left = rect.left - previewWidth - gap;
    var top = rect.top + (rect.height / 2) - (previewHeight / 2);

    // If it would go off-screen to the left, show it to the right instead
    if (left < 4) {
      left = rect.right + gap;
    }

    // Keep within vertical viewport bounds
    if (top < 4) {
      top = 4;
    }
    if (top + previewHeight > window.innerHeight - 4) {
      top = window.innerHeight - previewHeight - 4;
    }

    cardPreviewEl.style.left = left + 'px';
    cardPreviewEl.style.top = top + 'px';
  }

  async function fetchCardImage(cardName) {
    try {
      var response = await fetch('/api/card-image/' + encodeURIComponent(cardName));
      var result = await response.json();
      if (result.success && result.imageUrl) {
        return result.imageUrl;
      }
      return null;
    } catch (err) {
      console.error('Failed to fetch card image:', err);
      return null;
    }
  }

  function triggerImageFetch(cardNames) {
    fetch('/api/fetch-images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardNames: cardNames }),
    }).catch(function (err) {
      console.error('Failed to trigger image fetch:', err);
    });
  }

  async function loadCachedImages(cardNames) {
    try {
      var response = await fetch('/api/card-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardNames: cardNames }),
      });
      var result = await response.json();
      if (result.success && result.images) {
        for (var name in result.images) {
          if (result.images.hasOwnProperty(name)) {
            cardImageCache[name] = result.images[name];
          }
        }
      }
    } catch (err) {
      console.error('Failed to load cached images:', err);
    }
  }

  // ---- CSV Export ----
  function exportCsv() {
    if (currentResults.length === 0) return;

    var lines = ['Card Name,Najada.games Min,Najada.games Max,CernyRytir.cz Min,CernyRytir.cz Max,BlackLotus.cz Min,BlackLotus.cz Max,Best Price,Best Shop'];

    for (var i = 0; i < currentResults.length; i++) {
      var card = currentResults[i];
      var parts = ['"' + card.cardName.replace(/"/g, '""') + '"'];

      for (var j = 0; j < SHOPS.length; j++) {
        var shopData = card.shops[SHOPS[j]];
        if (shopData && shopData.priceMin !== null) {
          parts.push(shopData.priceMin);
          parts.push(shopData.priceMax !== null ? shopData.priceMax : shopData.priceMin);
        } else {
          parts.push('');
          parts.push('');
        }
      }

      var bestPrice = getBestPrice(card);
      var bestShop = getBestShop(card);
      parts.push(bestPrice !== Infinity ? bestPrice : '');
      parts.push(bestShop || '');

      lines.push(parts.join(','));
    }

    var csv = lines.join('\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'mpct-results.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---- Start ----
  init();
})();
