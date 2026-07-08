# Fixtures

Real `/api/v2` responses captured from a running BirdNET-Go instance. These are the
**source of truth** for the data contract — ahead of anything inferred from source
(CLAUDE.md). The typed client in `src/api/` was written from the Go structs; capturing
these validates it and pins the shapes for the build BirdNET-Go was on.

## Capture

Point `B` at your instance and run from the repo root. `jq` is only for pretty-printing.

```sh
B=http://192.168.1.10:8080
TODAY=$(date +%F)
WEEKAGO=$(date -v-7d +%F 2>/dev/null || date -d '7 days ago' +%F)

curl -s "$B/api/v2/detections?queryType=all&start_date=$TODAY&end_date=$TODAY&numResults=100&sortBy=date_desc" | jq . > fixtures/detections-search.json
curl -s "$B/api/v2/detections/recent?limit=10&includeWeather=true"                                             | jq . > fixtures/detections-recent.json
curl -s "$B/api/v2/analytics/species/summary?limit=20"                                                          | jq . > fixtures/species-summary.json
curl -s "$B/api/v2/analytics/species/summary?start_date=$WEEKAGO&end_date=$TODAY&limit=20"                      | jq . > fixtures/species-summary-windowed.json
curl -s "$B/api/v2/analytics/species/daily?date=$TODAY&limit=20"                                                | jq . > fixtures/species-daily.json
curl -s "$B/api/v2/media/species-image/info?name=Turdus%20merula"                                               | jq . > fixtures/species-image-info.json
curl -s "$B/api/v2/detections?date=not-a-date"                                                                  | jq . > fixtures/error-baddate.json
```

## Reconcile against `src/api/types.ts`

- Detections JSON is **camelCase**; analytics JSON is **snake_case**. Both are typed.
- Confirm `total` / `total_pages` are populated on `detections-search.json` — the polling
  loop stops on them.
- Confirm `timestamp` (RFC3339 with offset) is present on search rows — it's what the
  window filter uses; a missing one falls back to `date`+`time`.
- Detections carry **no image field**; the image URL is built client-side as
  `/api/v2/media/image/<url-escaped scientific name>`.
- `error-baddate.json` pins the error body shape (`ErrorResponse`).
