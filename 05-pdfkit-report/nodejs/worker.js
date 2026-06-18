const { parentPort } = require("worker_threads");
const { createCounterPdf } = require("./lib/create-counter-pdf");

parentPort.on("message", async ({ from, to }) => {
  try {
    const buffers = [];
    for (let n = from; n <= to; n++) {
      buffers.push(await createCounterPdf(n));
    }
    parentPort.postMessage({ buffers });
  } catch (err) {
    parentPort.postMessage({ error: err.message });
  }
});
