# Security

## Reporting a vulnerability

Email juanmartincerezo@gmail.com with the details and, if possible, a proof of concept. Please do not open a public issue. I answer within five days.

## Scope

- API endpoints and database queries.
- Exposure of the GCBA API credentials.
- Dependencies with known vulnerabilities.

## Out of scope

- The accuracy of the data published by GCBA or SBASE.
- Issues that require physical access or deploy credentials.

## Notes for self-hosters

- The app needs `SUBTE_CLIENT_ID` and `SUBTE_CLIENT_SECRET`. Request your own key at https://apitransporte.buenosaires.gob.ar/ and keep it in the environment, never in the repository.
- All database access happens on the server. `DATABASE_URL` is never sent to the browser.
- `POST /api/reports` is public by design (user reports). If you deploy it at scale, add rate limiting in front of it.
