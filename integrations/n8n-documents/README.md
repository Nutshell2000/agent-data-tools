# n8n-nodes-document-extract

An [n8n](https://n8n.io) community node that turns files into data your workflow can use:

- **Convert to Text**: a Word (.docx), Excel (.xlsx), PowerPoint (.pptx) or PDF file as Markdown or plain text. Headings, lists and tables of a Word file are kept, each sheet of a workbook becomes a table, a deck comes slide by slide.
- **Extract Fields**: the fields you name, as JSON. Give it an invoice and ask for `supplier, invoice_number, due_date, total, currency`; a field the file does not state comes back empty instead of guessed.
- **Extract Text From PDF**: a PDF page by page, with its page count, title and author.

Every operation takes a file from an earlier node (an e-mail attachment, a download, a form upload) or a public URL. Files are read by the Agent Data Tools API and are not stored.

## Installation

In n8n open **Settings > Community Nodes > Install** and enter `n8n-nodes-document-extract`. See the n8n documentation on [installing community nodes](https://docs.n8n.io/integrations/community-nodes/installation/).

## Credentials

The node needs an Agent Data Tools API key (it starts with `adt_`). Get one at <https://agent-data-tools.revmesh2074.workers.dev/credits>: the page shows the key right after checkout. Create a **Document Extract API** credential in n8n and paste it. The key is sent in the `Authorization` header and never in a URL.

## What it costs

A call costs a fixed price in credits (1 credit = $0.001). Failed calls are not charged.

| Operation | Tool | Price per call |
|---|---|---|
| Convert to Text | `/document/text` | $0.005 |
| Extract Fields | `/document/extract` | $0.03 |
| Extract Text From PDF | `/pdf/text` | $0.005 |

Credits come in packs from $1 (1,000 credits) or by monthly plan; both give one key. These are the prices on 14 November 2026; the current ones are at <https://agent-data-tools.revmesh2074.workers.dev/tools>.

## Using it

1. Add a node that outputs a file, for example **Gmail Trigger** with *Download Attachments* on, **HTTP Request** with a file response, or **Read/Write Files from Disk**.
2. Add **Document Extract**, pick the operation, keep **File Source** on *File From an Earlier Node* and name the binary field in **Input Binary Field** (`data` by default; Gmail attachments are `attachment_0`, `attachment_1`, ...).
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
- No OCR: a scanned PDF without a text layer has no text to read. It is refused and not charged.
- Old binary Office files (.doc, .xls, .ppt) and password-protected files are refused and not charged; save them as .docx, .xlsx or .pptx first.
- Excel cells hold the values the file stores: a formula's last result, and dates as Excel's day numbers.
- **Extract Fields** is read by an AI model from the first 24,000 characters of the file. Check values that matter, such as amounts, before you act on them.
- The node can be attached to an n8n AI Agent as a tool.

## Compatibility

Built with the n8n nodes API version 1 and tested with n8n 2.x.

## License

[MIT](LICENSE)
