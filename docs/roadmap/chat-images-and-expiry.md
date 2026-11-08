## Chat Images and Message Expiry [Completed]

Builds on the order chat (Customer Ordering Links, phase 5). Two parts: send pictures in the chat, and delete old
messages automatically.

### Images in chat [Completed]

**Implemented** (message expiry below is still planned). Differences from the plan:

- **Private container, not the `Images` table.** Pictures live in their own private container (`ChatImages:Container`,
  default `wtf-chat-images`, created with no public access; locally `App_Data/chat-images`). They are columns on
  `ConversationMessages` (`ImageKey`, `ImageContentType`, `ImageWidth`, `ImageHeight`, `ImageSizeBytes`,
  `ImageRemovedAt`), script `tools/sql/20261013_add_conversation_message_images.sql`. Because they are not in
  `Images`, Stale Image Cleanup never sees them; **message expiry must delete the blob with the message** (`ImageKey`).
- **Image library: SkiaSharp** (MIT, no key). ImageSharp 4 fails a Release build without a paid Six Labors licence key,
  and ImageSharp 3.1.12 has known high-severity decoder vulnerabilities, so neither is used. Every upload is decoded and
  written out again as a JPEG (no metadata), turned upright from its orientation tag, shrunk to 1600 px if larger, never
  scaled up, and flattened onto white. The type comes from the first bytes; the pixel size is read from the header before
  decoding.
- **Endpoints.** Staff: `POST /api/orders/{id}/messages/image`, `GET` and `DELETE /api/orders/{id}/messages/{messageId}/image`.
  Customer: `POST .../orders/{orderId}/messages/image` and `GET .../messages/{messageId}/image` under the link. Pictures
  are sent as `multipart/form-data` (`file`, `body`); served with our own type, `nosniff`, `inline`, private 60 s cache.
- **Limits.** 5 MB, 4096 px per side, 5 pictures a minute per address (`order-chat-image-policy`), 30 a day per customer
  (`ChatImages:DailyLimitPerCustomer`, counted from the database), and pictures count toward the ten messages before the
  shop replies. Refused uploads that look hostile are written to the audit log (`ChatImageRejected`); staff removal is
  `ChatImageRemoved`.
- **UI.** Attach button, preview with Remove, caption, client checks (type, 5 MB), spinner while sending, tap to enlarge,
  pictures load only when scrolled into view and are never stored on the device. Staff fetch a picture as a file with
  their login (the customer's link token is the proof for the customer). Staff can remove a picture after a confirm.
- Push text for a picture without text is "Sent a photo"; lists show "Sent a photo" or "Photo removed".
- **One validation for every picture upload.** `Services/ImageProcessing.cs` (`ImageSanitizer`, `ImageUploads`) now checks and
  cleans the chat photos AND the user, customer, product and promotion pictures: the real type from the first bytes (the
  file name is ignored), size and pixels from the header before decoding, then decode and write out again (no metadata,
  upright, shrunk to 2048 px at most, never scaled up). Chat always stores a JPEG on white; the others keep their own type
  and transparency, and the stored extension comes from what the picture really is (so a `.gif` name no longer matters).
  A refusal is now a 400 with an explanation instead of an empty 404. The endpoints share one reader that enforces the
  5 MB limit before reading the file (the customer, promotion and own-profile uploads had no limit before the handler).

Original plan:

Use case: a customer sends a GCash payment screenshot or a photo of what they want; staff send a product photo. Both
sides can send, and the customer is anonymous, so everything is enforced on the server.

- **Rules (server side, never trust the client).**
  - Allowed types: JPEG, PNG and WebP only. No SVG, GIF or HTML. The type is decided from the file's first bytes (magic
    numbers), not the file name or the `Content-Type` header.
  - Maximum 5 MB per image (`ChatImages:MaxBytes`) and a maximum pixel size (for example 4096 x 4096, against
    decompression bombs). One image per message, with an optional caption (the existing 1-1000 character body).
  - Re-encode every upload (decode, strip metadata such as GPS/EXIF, resize to about 1600 px, save as JPEG or WebP).
    This removes hidden payloads and means the stored file is ours, not the sender's.
  - Random server-generated file names in a dedicated `chat` folder; the original name is never stored or shown.
  - Served with our own `Content-Type`, `X-Content-Type-Options: nosniff` and `Content-Disposition: inline`.
- **Access.** Images are not public URLs. They are served by an endpoint that applies the same checks as the message
  list (customer: link check and the order must be theirs; staff: `OrdersRead`), either streaming the file or issuing a
  short-lived signed URL (a few minutes). Once the message is deleted the URL stops working.
- **Rate limiting.** Tighter than text (for example 5 images per minute and 30 per day per customer) using the existing
  `order-chat-policy` partitions; the "ten messages before the shop replies" rule counts images too. Read-only
  conversations accept no images, same as text.
- **Database.** New script `tools/sql/<date>_add_conversation_message_images.sql`: `ConversationMessages.ImageId` (null
  FK to `Images`) or its own table (blob key, content type, size, width, height); `Body` may be empty when an image is
  present (the rule becomes "text or image"). Then rescaffold.
- **API.** Staff and customer send endpoints accept `multipart/form-data` (file plus optional text); a GET for the image
  on each side; a larger request size limit on those endpoints only. Message DTOs get `imageUrl`, `imageWidth` and
  `imageHeight` (so the layout does not jump). The staff push says "Sent a photo" when there is no text.
- **UI.** Attach button in the shared chat component (file picker, camera on phones), a preview with Remove before
  sending, client-side type and size checks that use the server's messages (convenience only), progress and error
  state on the bubble, tap an image to see it larger. Images load lazily and are never stored on the customer's device
  (same rule as the rest of the public page).
- **Abuse.** Audit uploads that look hostile (wrong magic bytes, oversized), not every image. Staff can remove one
  message's image (the picture is deleted, a "photo removed" line stays).
- **Tests.** Wrong type renamed to `.jpg`, SVG, oversized file, oversized dimensions, corrupt image, a disguised
  executable, metadata gone after re-encode, rate limit, read-only conversation, another customer's order is 404, revoked
  link is 404, viewer role cannot send, response headers; front end: attach, preview, remove, error messages.

### Automatic message expiry [Completed]

**Implemented** (`ChatMessageExpiryService` and `ChatMessageExpiryScheduler` in `Features/Conversations`), settings under
`ChatRetention`. Differences from the plan below:

- **Same cold-start handling as the image cleanup.** Both daily jobs now share `DailyCatchUpScheduler`: a pass on startup
  and at least every 30 minutes asks "past the run time and not run today?" using the last run saved in report storage
  (`system/chat-message-expiry.json`), so a sleeping app catches up when it wakes. Run time is 03:00 Manila.
- **Rule.** A message goes `MessageDays` (default 90, `0` = keep for ever) after it was sent, but only when its order is
  Completed, Cancelled or Refunded (a chat with no order expires by age). Open orders (waiting or accepted) keep their chat.
  System lines ("Order accepted") expire with the rest. Orders are never changed.
- **Pictures.** The picture file is deleted first, then the message, in batches of `BatchSize` (500). A picture that cannot
  be deleted leaves its message for the next run; the rest of the run goes on. A conversation left empty is deleted too.
- **Safety.** `DryRun` (on in `appsettings.json`), `MaxDeletesPerRun` (5000), no audit entry (a background job has no
  user; each run is logged and saved as JSON), nothing at all when `MessageDays` is `0` or `Enabled` is false.
- **People are told.** `OrderConversationDto.retentionDays` drives a line in both chats: "Messages are deleted after N days
  once the order is finished."
- **Not built:** a live push so an open envelope drops expired chats at once; they disappear on the next refresh or open.
- Tests include a real SQL Server one (`ChatMessageExpiryDatabaseTests`).

Original plan:

- **Setting.** `ChatRetention:MessageDays` (default 90, `0` = keep forever), counted from each message's `CreatedAt`.
  A setting, not hard-coded; a change applies at the next run.
- **Hosted service** (`ChatMessageCleanupScheduler`, same pattern as the workbook scheduler, daily). Deletes messages
  older than the limit in small batches (for example 500 per statement) so a large backlog does not lock the table, and
  removes the message's image file at the same time (blob first, then row, so a failure leaves a row to retry instead of
  an orphan; Stale Image Cleanup is the safety net).
- **Conversations.** A conversation left with no messages is deleted too, so the envelope list shows no empty threads;
  the "Chat with the shop" card then starts a new one. Unread counts and the envelope update through the existing
  SignalR events, and an open chat drops deleted messages on its next refresh.
- **Order records are unaffected.** Deleting chat never changes an order, its status or its history. The system lines that
  record order changes ("Order accepted") are chat messages too; recommended: they expire with the rest, because the
  audit log is the permanent record.
- **Decisions (confirmed).**
  - Chats of orders that are still open (waiting or accepted) are kept regardless of age; messages expire only once the
    order is Completed, Cancelled or Refunded, counted from each message date.
  - The limit is shown to users ("Messages are deleted after 90 days"): a line in the staff panel and on the customer sheet.
- **Safety.** Dry-run on the first run, a cap per run, one audit entry per run with the counts, and no deletion at all
  when the setting is `0`.
- **Tests.** A message exactly at, before and after the limit; the open vs closed order rule; image blob removed with
  its message; empty conversation removed and non-empty one kept; `0` disables; batch limit; one failing blob delete does
  not stop the run; a real SQL Server test for the batch delete.

Suggested order: Stale Image Cleanup first (it also protects the chat images), then message expiry, then chat images.
