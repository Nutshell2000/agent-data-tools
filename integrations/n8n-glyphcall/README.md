# n8n-nodes-glyphcall

Glyphcall turns documents into data: files in, text and fields out. Made by SpellzCode.

An [n8n](https://n8n.io) community node that turns files into data your workflow can use:

- **Convert to Text**: a Word (.docx), Excel (.xlsx), PowerPoint (.pptx) or PDF file as Markdown or plain text. Headings, lists and tables of a Word file are kept, each sheet of a workbook becomes a table, a deck comes slide by slide.
- **Extract Fields**: the fields you name, as JSON. Give it an invoice and ask for `supplier, invoice_number, due_date, total, currency`; a field the file does not state comes back empty instead of guessed.
- **Extract Text From PDF**: a PDF page by page, with its page count, title and author.

And it works with EU e-invoices (XRechnung, ZUGFeRD, Factur-X and other EN 16931 invoices):

- **E-Invoice > Create**: invoice data as JSON in, XRechnung 3.0 XML (CII or UBL) or a ZUGFeRD / Factur-X PDF with the XML inside out, as a file in a binary field. Line totals, the VAT breakdown and the totals are computed and checked first; data that breaks a rule is refused with the rule numbers and not charged.
- **E-Invoice > Validate**: every broken business rule with its number (`BR-DE-15`, `BR-CO-15`), the field, the figures from your file and the fix.
- **E-Invoice > Convert to JSON**: an incoming e-invoice as JSON, from the XML or from the PDF with the XML inside. Exact values, no AI.

Every operation takes a file from an earlier node (an e-mail attachment, a download, a form upload) or a public URL. Files are read by the Glyphcall API and are not stored.

## Installation

In n8n open **Settings > Community Nodes > Install** and enter `n8n-nodes-glyphcall`. See the n8n documentation on [installing community nodes](https://docs.n8n.io/integrations/community-nodes/installation/).

## Credentials

The node needs a Glyphcall API key (it starts with `adt_`). Get one at <https://glyphcall.com/credits>: the page shows the key right after checkout. Create a **Glyphcall API** credential in n8n and paste it. The key is sent in the `Authorization` header and never in a URL.

## What it costs

A call costs a fixed price in credits (1 credit = $0.001). Failed calls are not charged.

| Operation | Tool | Price per call |
|---|---|---|
| Convert to Text | `/document/text` | $0.005 |
| Extract Fields | `/document/extract` | $0.03 |
| Extract Text From PDF | `/pdf/text` | $0.005 |
| E-Invoice > Create | `/einvoice/create` | $0.01 |
| E-Invoice > Validate | `/einvoice/validate` | $0.01 |
| E-Invoice > Convert to JSON | `/einvoice/to-json` | $0.01 |

Credits come in packs from $1 (1,000 credits) or by monthly plan; both give one key. These are the prices on 14 November 2026; the current ones are at <https://glyphcall.com/tools>.

## Using it

1. Add a node that outputs a file, for example **Gmail Trigger** with *Download Attachments* on, **HTTP Request** with a file response, or **Read/Write Files from Disk**.
2. Add **Glyphcall Documents**, pick the operation, keep **File Source** on *File From an Earlier Node* and name the binary field in **Input Binary Field** (`data` by default; Gmail attachments are `attachment_0`, `attachment_1`, ...).
3. For **Extract Fields**, list the field names you want, separated by commas.

The answer of **Extract Fields** looks like this:

```json
{
  "type": "pdf",
  "data": { "supplier": "Nordlys Design AB", "invoice_number": "2026-0147", "due_date": "2026-12-03", "total": 14686.25, "currency": "SEK" },
  "missing": [],
  "charsRead": 294,
  "truncated": false
}
```

A ready workflow is in [templates/invoice-attachment-to-sheet.json](templates/invoice-attachment-to-sheet.json): every new Gmail message with an invoice attached becomes one Google Sheets row. Import it with **Import from File** and connect your accounts.

## Good to know

- Files up to 10 MB. The kind of file is read from the file itself, not from its name.
- Scans and photos are read by OCR: PNG, JPEG and WebP images up to 3 MB, and scanned PDFs (up to three pages a call).
- Invoice lines and other rows: write the field as `line_items[description,quantity,unit_price,amount]` and every row comes back with exactly those keys.
- Old binary Office files (.doc, .xls, .ppt) and password-protected files are refused and not charged; save them as .docx, .xlsx or .pptx first.
- Excel cells hold the values the file stores: a formula's last result, and dates as Excel's day numbers.
- **Extract Fields** is read by an AI model from the first 24,000 characters of the file. Check values that matter, such as amounts, before you act on them.
- The node can be attached to an n8n AI Agent as a tool.
- E-invoices: files up to 5 MB. **Create** does not send the invoice anywhere; its ZUGFeRD PDF has one plain layout (no logo) and is built to PDF/A-3b but not certified by a PDF/A validator. Allowances and charges, attachments, card and direct-debit payments are not written. **Validate** runs a subset of the EN 16931 and XRechnung 3.0 business rules; it is not the official KoSIT validator and not tax advice.

## Compatibility

Built with the n8n nodes API version 1 and tested with n8n 2.x.

## License

[MIT](LICENSE)
