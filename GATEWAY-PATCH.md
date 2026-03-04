# Gateway.js Cookie-Parser Patch

Apply these 2 changes to gateway.js after cloning:

## Change 1: Add cookie-parser (after line 188 `const app = express();`)
Insert these 3 lines:
```js
// ============ COOKIE PARSER (required before CSRF and session handling) ============
const cookieParser = require('cookie-parser');
app.use(cookieParser());
```

## Change 2: Update CORS headers (in the CORS middleware section ~line 200)
Change:
```js
res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Device-ID, X-Sync-Token, X-App-Version, X-User-Id, X-Upload-Token, X-Session-Id');
```
To:
```js
res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Device-ID, X-Sync-Token, X-App-Version, X-User-Id, X-Upload-Token, X-Session-Id, X-CSRF-Token');
```

## After applying:
```bash
npm install cookie-parser
```

These patches are already included in the gateway-segments/ files on this branch.
