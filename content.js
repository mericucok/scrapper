

/**
 * This script is injected into the active tab to detect and highlight product information.
 * It uses a refined approach to distinguish products by price, image, and title,
 * while trying to avoid reviews and other non-product content.
 * It returns an array of detected products.
 */

(function() { // Anonymous function to avoid global scope pollution
    console.log("Starting product detection (content.js)...");
    const results = [];
    const processedContainers = new Set();

    // --- CONFIGURABLE CONSTANTS ---
    const MIN_CONTAINER_WIDTH = 100;
    const MAX_CONTAINER_WIDTH = 1000;
    const MIN_CONTAINER_HEIGHT = 100;
    const MAX_CONTAINER_HEIGHT = 1500;
    const MIN_IMAGE_SIZE_PX = 60; // For both width and height of an image element
    const MIN_NATURAL_IMAGE_SIZE_PX = 50; // For naturalWidth/Height of an image to avoid tiny icons
    const MAX_TITLE_LENGTH = 200;
    const MIN_TITLE_LENGTH = 5;
    const MAX_TEXT_ELEMENT_LENGTH = 50; // For initial price element text content

    // --- REFINED PRICE REGEX ---
    // More precise for common price formats, ensuring a digit is present and a currency.
    // Allows for optional currency symbol at start/end, numbers with commas/periods, and up to 2 decimals.
    // Expanded for common global currencies.
    const priceRegex = /(?:[\$€£¥₹₽₩₺]|(?:USD|EUR|GBP|JPY|AUD|CAD|CHF|CNY|SEK|NZD|KRW|INR|RUB|ZAR|SGD|TRY|TL|BRL|MXN|IDR|DKK|PLN|THB|HUF|CZK|ILS|MYR|PHP|RON|ARS|CLP|COP|EGP|HKD|IQD|JOD|KWD|LBP|MAD|MUR|NGN|NOK|OMR|QAR|SAR|VND)\s*)\s*\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{1,2})?\b|^\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{1,2})?\s*(?:[\$€£¥₹₽₩₺]|(?:USD|EUR|GBP|JPY|AUD|CAD|CHF|CNY|SEK|NZD|KRW|INR|RUB|ZAR|SGD|TRY|TL|BRL|MXN|IDR|DKK|PLN|THB|HUF|CZK|ILS|MYR|PHP|RON|ARS|CLP|COP|EGP|HKD|IQD|JOD|KWD|LBP|MAD|MUR|NGN|NOK|OMR|QAR|SAR|VND))$/i;

    // --- STRONGER REVIEW KEYWORD AND PATTERN DETECTION ---
    // Added more review-related phrases
    const reviewPattern = /\b(?:star(?:s)?|rating|review(?:s)?|out of \d+|sur \d+|from \d+(?:\.\d+)?|customer reviews|overall score|average rating|wertung|beoordeling)\b|^\d(?:\.\d+)?\/\d$/i;

    // --- Selectors for common review sections to completely ignore ---
    const reviewContainerSelectors = [
        '[itemprop="review"]', '[class*="review-section"]', '[id*="reviews"]', '[class*="rating-summary"]',
        '[class*="customer-reviews"]', '[aria-label*="rating"]', '[data-testid*="review"]', '[data-qa*="review"]',
        '.reviews', '.product-reviews', '.rating-stars', '.star-rating', '.score'
    ].join(',');

    // --- CSS for highlighting and notification (injected dynamically) ---
    const injectedCSS = `
        #product-detector-notification {
            position: fixed;
            top: 10px;
            right: 10px;
            background-color: rgba(0, 0, 0, 0.7);
            color: white;
            padding: 10px 15px;
            border-radius: 5px;
            z-index: 10000;
            font-size: 14px;
            font-family: sans-serif;
            opacity: 0;
            transition: opacity 0.5s ease-in-out;
            pointer-events: none; /* Allow clicks to pass through */
        }
        #product-detector-notification.error {
            background-color: rgba(200, 0, 0, 0.7);
        }
        .product-detector-highlight-image {
            border: 4px solid blueviolet !important;
            box-sizing: border-box !important;
            filter: brightness(90%) !important;
        }
        .product-detector-highlight-title {
            background-color: rgba(173, 216, 230, 0.7) !important; /* lightblue with transparency */
            padding: 2px 4px !important;
            border-radius: 3px !important;
        }
        .product-detector-highlight-price {
            background-color: rgba(255, 255, 0, 0.7) !important; /* yellow with transparency */
            padding: 2px 4px !important;
            border-radius: 3px !important;
        }
    `;

    // Inject styles into the head of the document
    function injectStyles() {
        const styleTag = document.createElement('style');
        styleTag.id = 'product-detector-styles'; // Give it an ID for potential removal/checking
        styleTag.textContent = injectedCSS;
        document.head.appendChild(styleTag);
    }
    injectStyles();

    // Helper to display a temporary notification on the page
    function displayPageNotification(message, type = 'info') {
        let notification = document.getElementById('product-detector-notification');
        if (!notification) {
            notification = document.createElement('div');
            notification.id = 'product-detector-notification';
            document.body.appendChild(notification);
        }

        notification.innerText = message;
        notification.classList.remove('error');
        if (type === 'error') {
            notification.classList.add('error');
        }

        notification.style.opacity = '1';
        notification.style.display = 'block'; // Ensure it's visible

        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => {
                notification.style.display = 'none';
            }, 500); // Wait for fade out
        }, 3000); // Display for 3 seconds
    }

    // 1. Find all potential price elements with stricter filtering.
    const potentialPriceElements = Array.from(document.querySelectorAll('span, div, p, strong, b, ins, a, [itemprop="price"], [data-price], [data-saleprice]'))
        .filter(el => {
            // Must be visible and not just empty space
            if (el.offsetParent === null || el.offsetWidth === 0 || el.offsetHeight === 0) return false;

            const text = el.innerText.trim();
            if (text.length === 0 || text.length > MAX_TEXT_ELEMENT_LENGTH) return false; // Text must exist and be reasonably short

            // --- IMMEDIATE EXCLUSION: If it's inside a known review container (using el.closest) ---
            if (el.closest(reviewContainerSelectors)) {
                // console.log("Skipping element inside review container:", text);
                return false;
            }

            // --- Semantic Price Attribute Check ---
            const hasSemanticPriceAttr = el.hasAttribute('data-price') ||
                                         el.hasAttribute('data-saleprice') ||
                                         (el.hasAttribute('itemprop') && el.getAttribute('itemprop').toLowerCase().includes('price'));

            // --- Semantic Review Attribute Check ---
            const isReviewElement = (el.hasAttribute('itemprop') && (el.getAttribute('itemprop').toLowerCase().includes('reviewrating') || el.getAttribute('itemprop').toLowerCase().includes('ratingvalue'))) ||
                                    el.hasAttribute('data-rating');

            if (isReviewElement) {
                // console.log("Skipping element with review semantic attribute:", text);
                return false; // Definitely a review if it has these attributes
            }

            // --- Text-based Review Pattern Check ---
            if (reviewPattern.test(text)) {
                // console.log("Skipping element matching review text pattern:", text);
                return false; // Looks like a review score
            }

            // --- Final Price Regex Check ---
            if (priceRegex.test(text)) {
                // console.log("Potential price found:", text, "Semantic attr:", hasSemanticPriceAttr);
                return true; // Passed all checks, looks like a price
            }

            return hasSemanticPriceAttr; // If no regex match but has semantic price attr, still consider it.
        });

    console.log(`Found ${potentialPriceElements.length} potential price elements after initial filtering.`);

    // 2. Iterate through each valid price to find its product context.
    potentialPriceElements.forEach(priceElement => {
        let productContainer = null;
        let image = null;
        let title = null;

        // 3. Travel up from the price element to find a reasonably-sized container.
        let currentElement = priceElement;
        // Climb up to 10 parents to find a suitable product card
        for (let i = 0; i < 10 && currentElement && currentElement.parentElement; i++) {
            currentElement = currentElement.parentElement;

            if (!currentElement || processedContainers.has(currentElement)) continue;

            // CRITICAL FIX: A product card must have a reasonable size.
            const { offsetWidth, offsetHeight } = currentElement;
            if (offsetWidth < MIN_CONTAINER_WIDTH || offsetHeight < MIN_CONTAINER_HEIGHT ||
                offsetWidth > MAX_CONTAINER_WIDTH || offsetHeight > MAX_CONTAINER_HEIGHT) {
                continue;
            }

            // 4. Check if this container holds a suitable product image.
            // Ensure the image is visible, large enough, and has natural dimensions.
            // Improved image URL extraction for lazy loading
            image = Array.from(currentElement.querySelectorAll('img'))
                         .find(img => img.offsetParent !== null && // Is visible
                                       img.offsetWidth > MIN_IMAGE_SIZE_PX && img.offsetHeight > MIN_IMAGE_SIZE_PX &&
                                       // Prioritize actual src or lazy-load attributes
                                       (img.src && !img.src.startsWith('data:image/gif;base64') && !img.src.includes('blank.gif') ||
                                        img.dataset.src || img.dataset.lazyload || img.getAttribute('data-src') ||
                                        img.srcset ||
                                        // Fallback to natural dimensions if not a tiny placeholder and not lazy-loaded explicitly
                                        (img.naturalWidth > MIN_NATURAL_IMAGE_SIZE_PX && img.naturalHeight > MIN_NATURAL_IMAGE_SIZE_PX && !img.loading)));
            
            // 5. If an image is found, check for a title.
            if (image) {
                const titleSelectors = 'h1, h2, h3, h4, h5, h6, a[href], [role="heading"], [itemprop="name"], .product-title, .item-name';
                const potentialTitles = Array.from(currentElement.querySelectorAll(titleSelectors));

                for (const el of potentialTitles) {
                    const titleText = el.innerText.trim();
                    // A valid title has text, isn't the price, isn't just a number, has reasonable length,
                    // and doesn't contain common review phrases.
                    if (titleText && titleText.length >= MIN_TITLE_LENGTH && titleText.length <= MAX_TITLE_LENGTH &&
                        !el.contains(priceElement) && // Title element does not contain the price element itself
                        !priceRegex.test(titleText) && // Ensure title doesn't look like a price
                        !/^\d+$/.test(titleText) && // Not just numbers
                        !reviewPattern.test(titleText) && // Doesn't contain review patterns
                        el.offsetParent !== null && // Title must also be visible
                        el.offsetWidth > 0 && el.offsetHeight > 0) // And have dimensions
                    {
                        title = el;
                        break;
                    }
                }
            }

            // 6. VALIDATION: If we have found all three parts within a small container.
            if (image && title) {
                productContainer = currentElement;
                break; // Success! This is our product card. Stop climbing.
            }
        }

        // 7. If a valid container was found, highlight and save the data.
        if (productContainer) {
            processedContainers.add(productContainer);

            // Extract the most reliable image URL
            let actualImageUrl = image.src;
            if (!actualImageUrl || actualImageUrl.startsWith('data:image/gif;base64') || actualImageUrl.includes('blank.gif')) {
                // Check for common lazy-load attributes
                actualImageUrl = image.dataset.src || image.dataset.lazyload || image.getAttribute('data-src');
            }
            // Fallback to srcset if available and not already a good src
            if ((!actualImageUrl || actualImageUrl.startsWith('data:image/gif')) && image.srcset) {
                const srcsetParts = image.srcset.split(',').map(s => s.trim().split(' '));
                if (srcsetParts.length > 0) {
                    actualImageUrl = srcsetParts[srcsetParts.length - 1][0]; // Take the last (often largest) from srcset
                }
            }
            if (!actualImageUrl || actualImageUrl.startsWith('data:')) actualImageUrl = 'N/A'; // Final fallback for data URIs

            // Apply highlighting to the elements found (using classes)
            if (image) {
                image.classList.add('product-detector-highlight-image');
            }
            if (title) {
                title.classList.add('product-detector-highlight-title');
            }
            if (priceElement) {
                priceElement.classList.add('product-detector-highlight-price');
            }

            results.push({
                title: title ? title.innerText.trim() : 'N/A',
                price: priceElement ? priceElement.innerText.trim() : 'N/A',
                imageUrl: actualImageUrl
            });
            // console.log("Product detected:", { title: title?.innerText, price: priceElement?.innerText, imageUrl: actualImageUrl });
        } else {
            // console.log("Failed to find a valid product container for price:", priceElement?.innerText);
        }
    });

    console.log(`Detection complete. Products found: ${results.length}`);
    if (results.length > 0) {
        displayPageNotification(`${results.length} product(s) detected and highlighted!`);
    } else {
        displayPageNotification("No products detected on this page.", 'error');
    }

    // Return the results to the popup.js script
    return results;
})(); // End of anonymous function
