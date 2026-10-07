# Family Store Billing — Version 1 (Realtime Database)

Simple responsive billing + inventory web application.

## Live Demo
** Launch the Website - https://store-billing-demo-five.vercel.app/
** Credentials: email - demo@gmail.com
                password - admin@123

## Firebase

This version uses Firebase Realtime Database.

Configured project:
- Project ID: vvvdryfruits-3f508
- Database region: Singapore / asia-southeast1

## Features

- Billing on laptop and Android tablet
- Manually enter product name, quantity and price
- Product autocomplete from inventory
- Automatic line totals
- Bill subtotal
- Fixed-amount or percentage discount
- Automatic final total
- Read-only Inventory view
- Master stock management for products, purchase price history, weight and packet quantities
- Weighted-average purchase price based on quantity received
- Automatic inventory deduction when a matching inventory product is billed
- Bill history
- Browser print receipt (58mm layout)

## Run locally

Use VS Code with Live Server, or another local HTTP server. Do not open index.html directly with file://.

## Firebase Realtime Database rules

For initial development, Firebase can use test mode. Before the store is used with real data, add authentication and proper Realtime Database security rules.

## Next phases

1. Test inventory persistence.
2. Test billing and stock deduction.
3. Improve store-specific receipt layout.
4. Add store name/address/phone settings.
5. Add proper authentication/security rules.
6. Add direct thermal-printer integration for the exact printer model.
7. Deploy as a PWA for the Android tablet.


## Troubleshooting the Firebase connection

If the page says "Firebase error":
- Hard refresh the page with Ctrl+Shift+R.
- Open F12 > Console.
- Make sure `firebase-database-compat.js` is loaded before `app.js`.
- The current project uses Firebase JS SDK 12.16.0 compat bundles.


## Version 2 additions

- Store settings saved in Firebase at `settings/store`
- Store name, address and phone appear on receipts
- Select 58mm or 80mm receipt width
- Delete inventory products
- Settings page in the application


## Version 2 — Print layout update

The website UI remains exactly as Version 2.

Only the print output was changed to a compact thermal-receipt layout:
- PRODUCT / QTY / PRICE / TOTAL columns
- Subtotal
- Discount
- Total
- Store header
- Bill number/date
- 58mm or 80mm print width
- Monospace thermal-printer-friendly formatting


## Version 3 — Authentication & security

The Version 2 UI and print layout are preserved. Added Firebase Email/Password login, logout, auth gating, and production-oriented Realtime Database rules in `database.rules.json`.

Create the first user in Firebase Console → Authentication → Users → Add user. Then replace the temporary Realtime Database rules with `database.rules.json`.

\n## Version 4 — Sales Reports\nAdded Reports without changing Billing or Inventory. Includes daily sales, bill count, discounts, average bill, top-selling products, daily bill list, and date selection.\n
\n## Version 5 — Backup & Export\n\nAdded a Backup section without changing Billing or Inventory. Includes:\n- Full JSON backup of settings, inventory and bills\n- Inventory CSV export\n- Sales CSV export\n\nRestore/import is intentionally not included yet; importing data will be added only after we design validation and duplicate-data protection.\n
\n## Version 6 — Master Stock Management

- Added a dedicated Master page after Inventory.
- Inventory is view-only and shows product, packet quantity and last update.
- All manual product and stock manipulation is done from Master.
- Tracks stock weight internally in grams and displays grams below 1 kg and kg at/above 1 kg.
- Tracks packet quantity separately.
- Supports a billing stock unit of packets or weight.
- Purchase price history is preserved for every stock purchase.
- Weighted-average purchase price is calculated using quantity received as the weighting basis.
- Existing product records remain compatible with the previous `quantity` and `purchasePrice` fields.
