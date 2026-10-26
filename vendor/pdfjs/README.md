# PDF.js browser build

This folder contains the prebuilt PDF.js 6.4.299 browser display and worker modules from pdfjs-dist, plus the CMaps and standard fonts used for text extraction.

- Upstream project: https://github.com/mozilla/pdf.js
- Package: https://www.npmjs.com/package/pdfjs-dist
- Main package license: Apache-2.0; see LICENSE.
- CMap and standard-font license files are retained in their respective folders.

The app uses PDF.js locally so selectable-text PDFs can be extracted without loading code from a CDN. Image-only/scanned PDFs still need OCR.
