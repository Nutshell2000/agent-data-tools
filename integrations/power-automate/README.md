# Power Automate connector (draft, not submitted)

A custom connector for Power Automate, Power Apps, Logic Apps and Copilot Studio with three actions:

| Action | What it does | Tool |
|---|---|---|
| Convert document to text | A Word, Excel, PowerPoint or PDF file from an earlier step as Markdown or plain text | `POST /document/text` |
| Convert document at URL to text | The same for a file at a public URL | `GET /document/text` |
| Extract text from PDF | A PDF page by page, with page count, title and author | `POST /pdf/text` |

The key travels in the `X-API-Key` header.

## Before it can be used or submitted

1. **Public domain.** The definition names `glyphcall.com` (bought 14 Nov 2026) and `support@glyphcall.com`. Neither works until the domain serves the service and that mailbox exists: check both before importing.
2. **The tools must be live.** `/document/text` and file upload on `/pdf/text` are live since release 1.166.0 on the workers.dev address.
   Check both on the public domain first.
3. **Try it as a custom connector.** In Power Automate: Data > Custom connectors > New > Import an OpenAPI file, then
   make a flow that feeds "File content" from "Get file content" (OneDrive or SharePoint) into each action. Run the
   solution checker. This needs a Microsoft account with a Power Automate licence: the owner's sign-in.
4. **Certification** (free): Microsoft's verified-publisher process for a service you own, described at
   https://learn.microsoft.com/en-us/connectors/custom-connectors/submit-certification. Requirements read on
   14 Nov 2026: own the service, API-key auth (this file), a support contact; 99.9% uptime is recommended. Whether a
   registered company is required was not confirmed. A certified connector to an outside service is Premium, so its
   users need a paid Power Automate licence.

## Notes

- A binary body is declared as `consumes: application/octet-stream` with a `string`/`binary` body parameter, the
  shape Microsoft's own file connectors use. The service reads the kind of file from its bytes.
- The response schemas list only the fields a flow builder maps; the service returns a few more
  (`url`, `source`, `bytes`, `sheets`, `slides`, `note`).
- Not offered here: the tools a free key does not cover (search, AI, rendering). A document connector that also
  lists unrelated actions is harder to find and to certify.
