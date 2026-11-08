## Image Storage CORS [Completed]

Browser `fetch()` of Azure Blob images from `https://wtfbyfaith.runasp.net` was blocked
(`No 'Access-Control-Allow-Origin' header`), so the offline image cache
(`ImageCacheService`) and the receipt image conversion could not download them on the web
build. Fixed in configuration (a CORS rule on the `wtfstorageacc` Blob service), not code.

- Keep the rule if the storage account or hosts change: allowed origins `https://wtfbyfaith.runasp.net`
  (plus any staging/dev origins), methods `GET, HEAD, OPTIONS`, allowed headers `*`,
  exposed headers `*`, max age `3600`.
- Still worth checking once: the Android (Capacitor) build.

---

