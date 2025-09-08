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

    // --- REFINED PRICE REGEX ---
    // More precise for common price formats, ensuring a digit is present and a currency.
    // Allows for optional currency symbol at start/end, numbers with commas/periods, and up to 2 decimals.
    // Expanded for common global currencies.
    const priceRegex = /(?:[\$€£¥₹₽₩]|(?:USD|EUR|GBP|JPY|AUD|CAD|CHF|CNY|SEK|NZD|KRW|INR|RUB|ZAR|SGD|TRY|BRL|MXN|IDR|DKK|PLN|THB|HUF|CZK|ILS|MYR|PHP|RON|ARS|CLP|COP|EGP|HKD|IQD|JOD|KWD|LBP|MAD|MUR|NGN|NOK|OMR|QAR|SAR|VND)\s*)\s*\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{1,2})?\b|^\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{1,2})?\s*(?:[\$€£¥₹₽₩]|(?:USD|EUR|GBP|JPY|AUD|CAD|CHF|CNY|SEK|NZD|KRW|INR|RUB|ZAR|SGD|TRY|BRL|MXN|IDR|DKK|PLN|THB|HUF|CZK|ILS|MYR|PHP|RON|ARS|CLP|COP|EGP|HKD|IQD|JOD|KWD|LBP|MAD|MUR|NGN|NOK|OMR|QAR|SAR|VND))$/i;

    // --- STRONGER REVIEW KEYWORD AND PATTERN DETECTION ---
    // Added more review-related phrases
    const reviewPattern = /\b(?:star(?:s)?|rating|review(?:s)?|out of \d+|sur \d+|from \d+(?:\.\d+)?|customer reviews|overall score|average rating|wertung|beoordeling)\b|^\d(?:\.\d+)?\/\d$/i;

    // --- NEW: Selectors for common review sections to completely ignore ---
    const reviewContainerSelectors = [
        '[itemprop="review"]', '[class*="review-section"]', '[id*="reviews"]', '[class*="rating-summary"]',
        '[class*="customer-reviews"]', '[aria-label*="rating"]', '[data-testid*="review"]', '[data-qa*="review"]',
        '.reviews', '.product-reviews', '.rating-stars', '.star-rating', '.score'
    ].join(',');

    // Helper to display a temporary notification on the page
    function displayPageNotification(message, type = 'info') {
        let notification = document.getElementById('product-detector-notification');
        if (!notification) {
            notification = document.createElement('div');
            notification.id = 'product-detector-notification';
            Object.assign(notification.style, {
                position: 'fixed',
                top: '10px',
                right: '10px',
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                color: 'white',
                padding: '10px 15px',
                borderRadius: '5px',
                zIndex: '10000',
                fontSize: '14px',
                fontFamily: 'sans-serif',
                opacity: '0',
                transition: 'opacity 0.5s ease-in-out'
            });
            document.body.appendChild(notification);
        }

        notification.innerText = message;
        notification.style.backgroundColor = type === 'error' ? 'rgba(200, 0, 0, 0.7)' : 'rgba(0, 0, 0, 0.7)';
        notification.style.opacity = '1';

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
            if (text.length === 0 || text.length > 50) return false; // Text must exist and be reasonably short

            // --- IMMEDIATE EXCLUSION: If it's inside a known review container ---
            let current = el;
            let isInReviewContainer = false;
            // Climb up a few parents to see if we're inside a review section
            for (let i = 0; i < 6 && current; i++) { // Increased climb depth slightly
                if (current.matches(reviewContainerSelectors)) {
                    isInReviewContainer = true;
                    break;
                }
                current = current.parentElement;
            }
            if (isInReviewContainer) {
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
        for (let i = 0; i < 10 && currentElement && currentElement.parentElement; i++) { // Increased climb depth
            currentElement = currentElement.parentElement;

            if (!currentElement || processedContainers.has(currentElement)) continue;

            // CRITICAL FIX: A product card must have a reasonable size.
            const { offsetWidth, offsetHeight } = currentElement;
            // Adjusted max height for more flexibility, kept min/max width similar
            if (offsetWidth < 100 || offsetHeight < 100 || offsetWidth > 1000 || offsetHeight > 1500) {
                continue;
            }

            // 4. Check if this container holds a suitable product image.
            // Ensure the image is visible, large enough, and has natural dimensions.
            // Improved image URL extraction for lazy loading
            image = Array.from(currentElement.querySelectorAll('img'))
                         .find(img => img.offsetParent !== null &&
                                       img.offsetWidth > 60 && img.offsetHeight > 60 && // Slightly reduced min size for smaller product images
                                       (img.naturalWidth > 50 && img.naturalHeight > 50 || img.loading === 'lazy' || img.dataset.src || img.srcset)); // Consider lazy-loaded
            
            // 5. If an image is found, check for a title.
            if (image) {
                const titleSelectors = 'h1, h2, h3, h4, h5, h6, a[href], [role="heading"], [itemprop="name"], .product-title, .item-name';
                const potentialTitles = Array.from(currentElement.querySelectorAll(titleSelectors));

                for (const el of potentialTitles) {
                    const titleText = el.innerText.trim();
                    // A valid title has text, isn't the price, isn't just a number, has reasonable length,
                    // and doesn't contain common review phrases.
                    if (titleText && titleText.length > 5 && titleText.length < 200 && // Adjusted length for more flexibility
                        !el.contains(priceElement) &&
                        !priceRegex.test(titleText) && // Ensure title doesn't look like a price
                        !/^\d+$/.test(titleText) &&
                        !reviewPattern.test(titleText) &&
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
            if (!actualImageUrl || actualImageUrl.includes('data:image/gif;base64') || actualImageUrl.includes('blank.gif')) {
                // Check for common lazy-load attributes
                actualImageUrl = image.dataset.src || image.dataset.lazyload || image.getAttribute('data-src');
            }
            // Fallback to srcset if available and not already a good src
            if ((!actualImageUrl || actualImageUrl.includes('data:image/gif')) && image.srcset) {
                const srcsetParts = image.srcset.split(',').map(s => s.trim().split(' '));
                if (srcsetParts.length > 0) {
                    actualImageUrl = srcsetParts[srcsetParts.length - 1][0]; // Take the last (often largest) from srcset
                }
            }
            if (!actualImageUrl) actualImageUrl = 'N/A'; // Final fallback

            // Apply highlighting to the elements found (null checks added for safety)
            if (image) {
                image.style.border = "4px solid blueviolet";
                image.style.boxSizing = "border-box";
                image.style.filter = "brightness(90%)"; // Subtle visual change
            }
            if (title) {
                title.style.backgroundColor = "rgba(173, 216, 230, 0.7)"; // lightblue with transparency
                title.style.padding = "2px 4px";
                title.style.borderRadius = "3px";
            }
            if (priceElement) {
                priceElement.style.backgroundColor = "rgba(255, 255, 0, 0.7)"; // yellow with transparency
                priceElement.style.padding = "2px 4px";
                priceElement.style.borderRadius = "3px";
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