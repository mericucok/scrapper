document.getElementById("highlightBtn").addEventListener("click", async () => {
  const highlightBtn = document.getElementById("highlightBtn");
  const statusMessage = document.getElementById("statusMessage");

  highlightBtn.disabled = true;
  statusMessage.textContent = "Detecting products...";

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  try {
    const injectionResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'] // Inject the content script file
    });

    // content.js will handle the actual detection, highlighting, and sending results back.
    // The result from executeScript will be an array of arrays if multiple frames,
    // where each inner array is the return value of content.js's main execution.
    // We expect content.js to return the array of detected products.
    const allProducts = injectionResults.flatMap(frame => frame.result || []);

    if (allProducts.length === 0) {
      statusMessage.textContent = "No products were detected.";
      console.log("No products were detected to save.");
      return;
    }

    let fileContent = "";
    allProducts.forEach(product => {
      fileContent += `Title: ${product.title}\n`;
      fileContent += `Image: ${product.imageUrl}\n`;
      fileContent += `Price: ${product.price}\n\n`;
    });

    const blob = new Blob([fileContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    chrome.downloads.download({
      url: url,
      filename: 'detected-products.txt',
      saveAs: true
    }, () => {
      if (chrome.runtime.lastError) {
        statusMessage.textContent = `Download failed: ${chrome.runtime.lastError.message}`;
        console.error("Download failed: ", chrome.runtime.lastError.message);
      } else {
        statusMessage.textContent = `Downloaded ${allProducts.length} product(s)!`;
      }
      highlightBtn.disabled = false;
    });

  } catch (error) {
    statusMessage.textContent = `Error: ${error.message}`;
    console.error("Script injection or execution failed: ", error);
    highlightBtn.disabled = false;
  }
});