import { createCounterPdf } from "./lib/create-counter-pdf.js";

self.onmessage = async (e) => {
  const { from, to } = e.data;
  try {
    const buffers = [];
    for (let n = from; n <= to; n++) {
      buffers.push(await createCounterPdf(n));
    }
    self.postMessage({ buffers });
  } catch (err) {
    self.postMessage({ error: err.message });
  }
};
