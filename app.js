/*
  FAMILY STORE BILLING - VERSION 1
  Firebase Realtime Database edition.
  Uses Firebase JS SDK 12.16.0 compat CDN bundles.

  This version supports:
  - Inventory
  - Product autocomplete
  - Billing
  - Amount / percentage discounts
  - Automatic stock deduction
  - Bill history
  - Browser receipt printing

  Direct USB thermal-printer support will be added after the
  billing/database workflow is tested.
*/

const firebaseConfig = {
  apiKey: "AIzaSyAIRH68qLR-xLWQMvy8FkAEBRkZKwMdIYU",
  authDomain: "billing-demo-65a6d.firebaseapp.com",
  databaseURL: "https://billing-demo-65a6d-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "billing-demo-65a6d",
  storageBucket: "billing-demo-65a6d.firebasestorage.app",
  messagingSenderId: "1038369652474",
  appId: "1:1038369652474:web:c8922b96c6752aaf7ad343"
};

let db = null;
let auth = null;
let firebaseReady = false;
let currentUser = null;
let products = [];
let billItems = [];
let bills = [];
let storeSettings = {
  name: "Family Store",
  address: "",
  phone: "",
  receiptWidth: 58
};

const $ = id => document.getElementById(id);
const money = n => `₹${Number(n || 0).toFixed(2)}`;

// Weight stock is stored internally as whole grams to avoid floating-point stock errors.
function roundNumber(value, decimals = 3) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function normalizeWeightGrams(value) {
  return Math.max(0, Math.round(Number(value || 0)));
}

function weightKgToGrams(value) {
  return normalizeWeightGrams(Number(value || 0) * 1000);
}

function formatBillQuantity(item) {
  const unit = item.stockUnit || item.uom || "packet";
  const qty = Number(item.qty || 0);
  return unit === "weight"
    ? `${roundNumber(qty, 3)} kg`
    : `${roundNumber(qty, 3)} packet${qty === 1 ? "" : "s"}`;
}

function initFirebase() {
  try {
    if (!window.firebase) {
      throw new Error("Firebase App SDK did not load.");
    }

    if (typeof firebase.database !== "function") {
      throw new Error(
        "Firebase Realtime Database SDK did not load. " +
        "Check the firebase-database-compat.js script in index.html."
      );
    }

    firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.database();
    firebaseReady = true;

    document.body.classList.add("auth-locked");
    $("loginScreen").classList.remove("hidden");

    auth.onAuthStateChanged(async user => {
      currentUser = user;
      if (user) {
        document.body.classList.remove("auth-locked");
        $("loginScreen").classList.add("hidden");
        $("logoutBtn").classList.remove("hidden");
        $("connectionStatus").textContent = "Connected";
        $("loginError").textContent = "";
        await loadSettings();
        await loadProducts();
        await loadBills();
      } else {
        document.body.classList.add("auth-locked");
        $("loginScreen").classList.remove("hidden");
        $("logoutBtn").classList.add("hidden");
        $("connectionStatus").textContent = "Signed out";
      }
    });
  } catch (err) {
    console.error("Firebase initialization error:", err);
    $("connectionStatus").textContent = "Firebase error";
    toast(err.message || "Firebase connection failed.");
  }
}

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2200);
}

async function signIn() {
  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value;
  $("loginError").textContent = "";
  if (!email || !password) {
    $("loginError").textContent = "Enter your email and password.";
    return;
  }
  const button = $("loginBtn");
  button.disabled = true;
  button.textContent = "Signing in...";
  try {
    await auth.signInWithEmailAndPassword(email, password);
  } catch (err) {
    console.error("Login error:", err);
    const messages = {
      "auth/invalid-credential": "Incorrect email or password.",
      "auth/invalid-email": "Enter a valid email address.",
      "auth/too-many-requests": "Too many attempts. Try again later."
    };
    $("loginError").textContent = messages[err.code] || err.message || "Sign in failed.";
  } finally {
    button.disabled = false;
    button.textContent = "Sign In";
  }
}
$("loginBtn").addEventListener("click", signIn);
$("loginPassword").addEventListener("keydown", e => { if (e.key === "Enter") signIn(); });
$("loginEmail").addEventListener("keydown", e => { if (e.key === "Enter") $("loginPassword").focus(); });
$("logoutBtn").addEventListener("click", async () => {
  if (!confirm("Are you sure you want to sign out?")) return;

  try {
    await auth.signOut();
  } catch (err) {
    console.error(err);
    toast("Could not sign out.");
  }
});

function switchPage(page) {
  document.querySelectorAll(".page").forEach(x =>
    x.classList.toggle("active", x.id === page)
  );
  document.querySelectorAll(".tab").forEach(x =>
    x.classList.toggle("active", x.dataset.page === page)
  );
  if (page === "inventory") renderInventory();
  if (page === "master") renderMaster();
  if (page === "history") renderHistory();
  if (page === "reports") renderReports();
  if (page === "settings") renderSettings();
}

document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => switchPage(btn.dataset.page));
});

function generateBillNumber() {
  const now = new Date();
  return `B${now.getFullYear()}${String(now.getMonth()+1).padStart(2,"0")}${String(now.getDate()).padStart(2,"0")}-${String(Date.now()).slice(-5)}`;
}

$("billNumber").textContent = generateBillNumber();

function renderBill() {
  const body = $("billItems");
  body.innerHTML = "";
  $("emptyBill").style.display = billItems.length ? "none" : "block";

  let subtotal = 0;

  billItems.forEach((item, index) => {
    const total = Number(item.price || 0);
    subtotal += total;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(formatBillQuantity(item))}</td>
      <td>${money(item.price)}</td>
      <td>${money(total)}</td>
      <td><button class="remove-item" data-index="${index}">Remove</button></td>
    `;
    body.appendChild(tr);
  });

  body.querySelectorAll(".remove-item").forEach(btn => {
    btn.addEventListener("click", () => {
      billItems.splice(Number(btn.dataset.index), 1);
      renderBill();
    });
  });

  const discountType = $("discountType").value;
  const discountValue = Math.max(0, Number($("discountValue").value) || 0);

  const discount = discountType === "percent"
    ? subtotal * Math.min(discountValue, 100) / 100
    : Math.min(discountValue, subtotal);

  $("subtotal").textContent = money(subtotal);
  $("grandTotal").textContent = money(Math.max(0, subtotal - discount));
}

function updateBillUnitFields() {
  const product = findProductByName($("billProduct").value);
  const unit = product ? productStockUnit(product) : null;
  const unitLabel = $("billQtyUnit");
  const priceLabel = $("billPriceLabel");
  if (unitLabel) unitLabel.textContent = unit ? (unit === "weight" ? "(kg)" : "(packets)") : "";
  if (priceLabel) priceLabel.textContent = unit === "weight" ? "Price / kg (₹)" : unit === "packet" ? "Price / packet (₹)" : "Price / unit (₹)";
  if (unit === "weight") {
    $("billQty").step = "0.001";
    $("billQty").min = "0.001";
  } else if (unit === "packet") {
    $("billQty").step = "1";
    $("billQty").min = "1";
  }
}

function addBillItem() {
  const name = $("billProduct").value.trim();
  const qty = Number($("billQty").value);
  const price = Number($("billPrice").value);

  if (!name) return toast("Enter a product name.");

  const product = findProductByName(name);
  if (!product) return toast(`"${name}" is not in inventory.`);

  const stockUnit = productStockUnit(product);
  if (!qty || qty <= 0) return toast("Enter a valid quantity.");
  if (stockUnit === "packet" && !Number.isInteger(qty)) return toast("Packet quantity must be a whole number.");
  if (price < 0 || Number.isNaN(price)) return toast("Enter a valid price.");

  const available = productBasisQuantity(product);
  const requested = stockUnit === "weight" ? weightKgToGrams(qty) : qty;
  if (requested > available) {
    return toast(stockUnit === "weight"
      ? `Only ${formatStockWeight(available)} is available.`
      : `Only ${available} packet${available === 1 ? "" : "s"} is available.`);
  }

  billItems.push({
    name: product.name,
    qty: stockUnit === "weight" ? roundNumber(qty, 3) : Math.round(qty),
    price: roundNumber(price, 2),
    stockUnit,
    uom: stockUnit
  });

  $("billProduct").value = "";
  $("billQty").value = "1";
  $("billPrice").value = "";
  $("billQtyUnit").textContent = "";
  $("billPriceLabel").textContent = "Price / unit (₹)";
  $("billSuggestions").style.display = "none";

  $("billProduct").focus();
  renderBill();
}

$("addItemBtn").addEventListener("click", addBillItem);
$("discountType").addEventListener("change", renderBill);
$("discountValue").addEventListener("input", renderBill);

$("billProduct").addEventListener("input", () => {
  updateBillUnitFields();
  const q = $("billProduct").value.trim().toLowerCase();
  const box = $("billSuggestions");

  if (!q) {
    box.style.display = "none";
    return;
  }

  const matches = products
    .filter(p => p.name.toLowerCase().includes(q))
    .slice(0, 8);

  box.innerHTML = "";

  matches.forEach(p => {
    const div = document.createElement("div");
    div.className = "suggestion";
    div.textContent = p.stockUnit === "weight"
      ? `${p.name} — stock: ${formatStockWeight(p.weightGrams)}`
      : `${p.name} — stock: ${Number(p.packetQuantity ?? p.quantity ?? 0)} packets`;

    div.addEventListener("click", () => {
      $("billProduct").value = p.name;
      box.style.display = "none";
      updateBillUnitFields();
      $("billQty").focus();
    });

    box.appendChild(div);
  });

  box.style.display = matches.length ? "block" : "none";
});

document.addEventListener("click", e => {
  if (!e.target.closest(".product-field")) {
    $("billSuggestions").style.display = "none";
  }
});

$("billProduct").addEventListener("keydown", e => {
  if (e.key === "Enter") $("billQty").focus();
});

$("billPrice").addEventListener("keydown", e => {
  if (e.key === "Enter") addBillItem();
});

$("clearBillBtn").addEventListener("click", () => {
  if (!billItems.length || confirm("Clear this bill?")) {
    billItems = [];
    $("discountValue").value = "0";
    updateBillUnitFields();
    renderBill();
  }
});

let savingBill = false;

async function saveBill() {
  if (savingBill) return;

  if (!billItems.length) {
    toast("Add at least one item.");
    return;
  }

  savingBill = true;
  const saveButton = $("savePrintBtn");
  saveButton.disabled = true;
  saveButton.textContent = "Saving...";

  const subtotal = roundNumber(billItems.reduce((s, x) => s + Number(x.price || 0), 0), 2);
  const discountValue = Math.max(0, Number($("discountValue").value) || 0);
  const discountType = $("discountType").value;

  const discount = roundNumber(discountType === "percent"
    ? subtotal * Math.min(discountValue, 100) / 100
    : Math.min(discountValue, subtotal), 2);

  const total = roundNumber(Math.max(0, subtotal - discount), 2);

  const bill = {
    billNumber: $("billNumber").textContent,
    createdAt: Date.now(),
    items: billItems.map(x => ({ ...x })),
    subtotal,
    discount,
    discountType,
    discountValue,
    total
  };

  if (!firebaseReady) {
    bills.unshift(bill);
    printBill(bill);
    resetForNextBill();
    updateBillUnitFields();
    savingBill = false;
    saveButton.disabled = false;
    saveButton.textContent = "Save & Print Bill";
    return;
  }

  try {
    const productsSnapshot = await db.ref("products").once("value");
    const productData = productsSnapshot.val() || {};
    const deductions = {};

    for (const item of bill.items) {
      const match = Object.entries(productData).find(
        ([, p]) => p && String(p.nameLower || "").toLowerCase() === item.name.toLowerCase()
      );

      if (!match) {
        throw new Error(`"${item.name}" is not in inventory.`);
      }

      const [productId, rawProduct] = match;
      const product = {
        ...rawProduct,
        stockUnit: rawProduct.stockUnit || "packet",
        packetQuantity: Number(rawProduct.packetQuantity ?? rawProduct.quantity ?? 0),
        weightGrams: normalizeWeightGrams(rawProduct.weightGrams ?? 0)
      };

      const itemUnit = item.stockUnit || item.uom || product.stockUnit;
      if (itemUnit !== product.stockUnit) {
        throw new Error(`Unit of measurement for "${item.name}" no longer matches the product.`);
      }

      const requestedDisplayQty = Number(item.qty || 0);
      const requested = itemUnit === "weight"
        ? weightKgToGrams(requestedDisplayQty)
        : Math.round(requestedDisplayQty);
      const alreadyDeducted = deductions[productId] || 0;
      const totalRequested = alreadyDeducted + requested;

      if (product.stockUnit === "weight") {
        if (product.weightGrams < totalRequested) {
          throw new Error(
            `Not enough weight stock for "${item.name}". Available: ${formatStockWeight(product.weightGrams)}, required: ${formatStockWeight(totalRequested)}`
          );
        }
      } else {
        if (product.packetQuantity < totalRequested) {
          throw new Error(
            `Not enough packet stock for "${item.name}". Available: ${product.packetQuantity}, required: ${totalRequested}`
          );
        }
      }

      deductions[productId] = totalRequested;
    }

    const updates = {};
    updates[`bills/${bill.billNumber}`] = bill;

    Object.entries(deductions).forEach(([productId, deduction]) => {
      const rawProduct = productData[productId] || {};
      const stockUnit = rawProduct.stockUnit || "packet";
      const packetQuantity = Number(rawProduct.packetQuantity ?? rawProduct.quantity ?? 0);
      const weightGrams = normalizeWeightGrams(rawProduct.weightGrams ?? 0);

      if (stockUnit === "weight") {
        const newWeight = Math.max(0, weightGrams - Math.round(deduction));
        updates[`products/${productId}/weightGrams`] = newWeight;
        updates[`products/${productId}/quantity`] = packetQuantity;
      } else {
        const newPackets = Math.max(0, packetQuantity - deduction);
        updates[`products/${productId}/packetQuantity`] = newPackets;
        updates[`products/${productId}/quantity`] = newPackets;
      }

      updates[`products/${productId}/updatedAt`] = Date.now();
    });

    await db.ref().update(updates);

    toast("Bill saved. Preparing print...");
    await loadProducts();
    await loadBills();

    printBill(bill);
    resetForNextBill();
  } catch (err) {
    console.error(err);
    toast(err.message || "Could not save bill.");
  } finally {
    savingBill = false;
    saveButton.disabled = false;
    saveButton.textContent = "Save & Print Bill";
  }
}

$("savePrintBtn").addEventListener("click", saveBill);

function resetForNextBill() {
  billItems = [];
  $("discountValue").value = "0";
  $("billNumber").textContent = generateBillNumber();
  updateBillUnitFields();
  renderBill();
}

function printBill(bill) {
  const time = new Date().toLocaleString("en-IN");
  const receiptWidth = Number(storeSettings.receiptWidth) === 80 ? 80 : 58;

  const storeName = escapeHtml(storeSettings.name || "Family Store");
  const storeAddress = escapeHtml(storeSettings.address || "");
  const storePhone = escapeHtml(storeSettings.phone || "");

  // Print-only receipt layout. The normal website billing UI is untouched.
  const rows = bill.items.map(item => `
    <div class="p-row">
      <div class="p-product">${escapeHtml(item.name)}</div>
      <div class="p-qty">${escapeHtml(formatBillQuantity(item))}</div>
      <div class="p-price">${Number(item.price).toFixed(2)}</div>
      <div class="p-total">${Number(item.price).toFixed(2)}</div>
    </div>
  `).join("");

  const html = `
    <div id="printArea" class="print-receipt print-${receiptWidth}">
      <div class="p-store-name">${storeName}</div>
      ${storeAddress ? `<div class="p-store-info">${storeAddress}</div>` : ""}
      ${storePhone ? `<div class="p-store-info">PH: ${storePhone}</div>` : ""}

      <div class="p-meta">
        <span>Bill: ${escapeHtml(bill.billNumber)}</span>
        <span>${escapeHtml(time)}</span>
      </div>

      <div class="p-rule"></div>

      <div class="p-table-head">
        <div>PRODUCT</div>
        <div>QTY</div>
        <div>PRICE</div>
        <div>TOTAL</div>
      </div>

      <div class="p-rule"></div>

      <div class="p-items">
        ${rows}
      </div>

      <div class="p-rule"></div>

      <div class="p-summary">
        <div><span>SUBTOTAL</span><strong>${money(bill.subtotal)}</strong></div>
        <div><span>DISCOUNT</span><strong>${money(bill.discount)}</strong></div>
      </div>

      <div class="p-rule p-short-rule"></div>

      <div class="p-final">
        <span>TOTAL</span>
        <strong>${money(bill.total)}</strong>
      </div>

      <div class="p-rule"></div>

      <div class="p-thanks">THANK YOU! VISIT AGAIN</div>
    </div>`;

  document.getElementById("printArea")?.remove();
  document.body.insertAdjacentHTML("beforeend", html);

  // Print-only styling. This does not change the on-screen billing page.
  const printStyle = document.createElement("style");
  printStyle.id = "receiptPrintStyle";
  printStyle.textContent = `
    @media print {
      @page {
        size: auto;
        margin: 0;
      }

      html, body {
        margin: 0 !important;
        padding: 0 !important;
        background: #fff !important;
      }

      body * {
        visibility: hidden !important;
      }

      #printArea,
      #printArea * {
        visibility: visible !important;
      }

      #printArea {
        position: absolute !important;
        left: 0 !important;
        top: 0 !important;
        box-sizing: border-box !important;
        margin: 0 !important;
        color: #000 !important;
        background: #fff !important;
        font-family: "Courier New", Courier, monospace !important;
        font-size: 10px !important;
        line-height: 1.25 !important;
        padding: 3mm !important;
      }

      #printArea.print-58 { width: 58mm !important; }
      #printArea.print-80 { width: 80mm !important; }

      .p-store-name {
        text-align: center !important;
        font-size: 14px !important;
        font-weight: 700 !important;
        margin-bottom: 1px !important;
      }

      .p-store-info {
        text-align: center !important;
        font-size: 9px !important;
      }

      .p-meta {
        display: flex !important;
        justify-content: space-between !important;
        gap: 5px !important;
        margin-top: 6px !important;
        font-size: 9px !important;
      }

      .p-rule {
        border-top: 1px dashed #000 !important;
        height: 1px !important;
        margin: 5px 0 !important;
      }

      .p-table-head,
      .p-row {
        display: grid !important;
        grid-template-columns: minmax(0, 1fr) 27px 48px 48px !important;
        column-gap: 3px !important;
        align-items: start !important;
      }

      .print-80 .p-table-head,
      .print-80 .p-row {
        grid-template-columns: minmax(0, 1fr) 35px 58px 58px !important;
      }

      .p-table-head {
        font-weight: 700 !important;
        font-size: 9px !important;
      }

      .p-table-head > div:not(:first-child),
      .p-row > div:not(:first-child) {
        text-align: right !important;
      }

      .p-row {
        font-size: 9px !important;
        min-height: 15px !important;
      }

      .p-product {
        overflow-wrap: anywhere !important;
        padding-right: 2px !important;
      }

      .p-summary {
        width: 72% !important;
        margin-left: auto !important;
        font-size: 9px !important;
      }

      .p-summary > div,
      .p-final {
        display: flex !important;
        justify-content: space-between !important;
        gap: 8px !important;
      }

      .p-short-rule {
        width: 72% !important;
        margin-left: auto !important;
      }

      .p-final {
        font-size: 11px !important;
        font-weight: 700 !important;
        margin: 4px 0 !important;
      }

      .p-thanks {
        text-align: center !important;
        font-size: 9px !important;
        font-weight: 700 !important;
      }
    }
  `;

  document.head.appendChild(printStyle);
  window.print();

  setTimeout(() => {
    document.getElementById("printArea")?.remove();
    document.getElementById("receiptPrintStyle")?.remove();
  }, 1000);
}

// INVENTORY + MASTER

function formatStockWeight(grams) {
  const g = Math.max(0, Number(grams) || 0);
  if (g < 1000) return `${Math.round(g * 1000) / 1000}gm`;
  const kg = g / 1000;
  return `${Number.isInteger(kg) ? kg : kg.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}kg`;
}

function productStockUnit(product) {
  return product && product.stockUnit === "weight" ? "weight" : "packet";
}

function productBasisQuantity(product) {
  return productStockUnit(product) === "weight"
    ? Number(product.weightGrams || 0)
    : Number(product.packetQuantity ?? product.quantity ?? 0);
}

function productAveragePrice(product) {
  if (product.weightedAvgPurchasePrice != null) {
    return Number(product.weightedAvgPurchasePrice) || 0;
  }
  return Number(product.purchasePrice || 0);
}

function normalizedPurchaseHistory(product) {
  return Array.isArray(product.priceHistory)
    ? product.priceHistory
        .map((entry, index) => {
          const stockUnit = entry.stockUnit || productStockUnit(product);
          let basisQuantity = Number(entry.basisQuantity || 0);
          // Older versions stored weight history basis in grams while the price was per kg.
          // Detect that legacy shape and convert it to kg for weighted-average calculations.
          if (stockUnit === "weight" && Number(entry.weightGrams || 0) > 0 && basisQuantity === Number(entry.weightGrams || 0)) {
            basisQuantity = roundNumber(basisQuantity / 1000, 3);
          }
          return {
            ...entry,
            price: Number(entry.price || 0),
            basisQuantity,
            weightGrams: normalizeWeightGrams(entry.weightGrams || 0),
            packetQuantity: Number(entry.packetQuantity || 0),
            stockUnit,
            vendor: String(entry.vendor || "Not recorded"),
            createdAt: Number(entry.createdAt || 0),
            _index: index
          };
        })
        .filter(entry => entry.price >= 0)
    : [];
}

function calculatePurchaseStats(product) {
  const history = normalizedPurchaseHistory(product);
  if (!history.length) {
    const average = productAveragePrice(product);
    return {
      history,
      previousPrice: null,
      latestPrice: average,
      weightedAverage: average,
      totalBasis: 0
    };
  }

  const totalBasis = history.reduce((sum, entry) => sum + Math.max(0, entry.basisQuantity), 0);
  const totalCost = history.reduce(
    (sum, entry) => sum + (Math.max(0, entry.basisQuantity) * entry.price),
    0
  );
  const latest = history[history.length - 1];
  const previous = history.length > 1 ? history[history.length - 2] : null;

  return {
    history,
    previousPrice: previous ? previous.price : null,
    latestPrice: latest.price,
    weightedAverage: totalBasis > 0 ? totalCost / totalBasis : latest.price,
    totalBasis
  };
}

function renderInventory() {
  const q = $("inventorySearch").value.trim().toLowerCase();
  const body = $("inventoryItems");
  body.innerHTML = "";

  const matches = products.filter(p => p.name.toLowerCase().includes(q));

  matches.forEach(p => {
    const unit = productStockUnit(p);
    const quantity = productBasisQuantity(p);
    const lowStock = unit === "weight" ? quantity <= 5000 : quantity <= 5;
    const displayQuantity = unit === "weight"
      ? formatStockWeight(quantity)
      : String(quantity);
    const unitLabel = unit === "weight" ? "Weight" : "Packets";

    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${escapeHtml(p.name)}</td>
      <td class="${lowStock ? "low-stock" : ""}">${escapeHtml(displayQuantity)}</td>
      <td>${unitLabel}</td>
      <td>${formatDate(p.updatedAt)}</td>
    `;

    body.appendChild(tr);
  });

  if (!matches.length) {
    body.innerHTML = `<tr><td colspan="4" class="empty">No products found.</td></tr>`;
  }
}

$("inventorySearch").addEventListener("input", renderInventory);

function clearMasterProductForm() {
  $("masterProductName").value = "";
  $("masterProductUnit").value = "weight";
  $("masterProductName").focus();
}

function clearMasterPurchaseForm() {
  $("masterPurchaseProduct").value = "";
  $("masterPurchaseQuantity").value = "";
  $("masterPurchaseUnitDisplay").value = "—";
  $("masterPurchasePrice").value = "";
  $("masterVendor").value = "";
  $("masterPurchaseSuggestions").style.display = "none";
  updateMasterPurchaseLabels();
  $("masterPurchaseProduct").focus();
}

function updateMasterPurchaseLabels() {
  const product = findProductByName($("masterPurchaseProduct").value);
  const unit = product ? productStockUnit(product) : null;
  const priceLabel = $("masterPurchasePriceLabel");
  const unitDisplay = $("masterPurchaseUnitDisplay");

  if (priceLabel) {
    priceLabel.textContent = unit === "weight"
      ? "Purchase price / kg (₹)"
      : unit === "packet"
        ? "Purchase price / packet (₹)"
        : "Purchase price / unit (₹)";
  }

  if (unitDisplay) {
    unitDisplay.value = unit === "weight" ? "Weight (kg)" : unit === "packet" ? "Packets" : "—";
  }

  $("masterPurchaseHelp").textContent = product
    ? `This purchase will add stock in ${unit === "weight" ? "kg" : "packets"}. The unit is fixed by the product.`
    : "Select a product to see its unit of measurement.";

  const summary = $("masterPurchaseSummary");
  if (summary) {
    if (!product) {
      summary.textContent = "Select a product to see its current purchase information.";
    } else {
      const stats = calculatePurchaseStats(product);
      summary.innerHTML = `
        <strong>${escapeHtml(product.name)}</strong> ·
        Latest ${stats.latestPrice == null ? "—" : money(stats.latestPrice)} ·
        Average ${money(stats.weightedAverage)} ·
        ${stats.history.length} purchase${stats.history.length === 1 ? "" : "s"}
      `;
    }
  }
}

function findProductByName(name) {
  const lower = String(name || "").trim().toLowerCase();
  return products.find(p => p.name.toLowerCase() === lower);
}

function renderMasterPurchaseSuggestions() {
  const q = $("masterPurchaseProduct").value.trim().toLowerCase();
  const box = $("masterPurchaseSuggestions");

  if (!q) {
    box.style.display = "none";
    return;
  }

  const matches = products.filter(p => p.name.toLowerCase().includes(q)).slice(0, 8);
  box.innerHTML = "";

  matches.forEach(p => {
    const div = document.createElement("div");
    div.className = "suggestion";
    div.textContent = `${p.name} — ${productStockUnit(p) === "weight" ? "Weight" : "Packets"}`;

    div.addEventListener("click", () => {
      $("masterPurchaseProduct").value = p.name;
      box.style.display = "none";
      updateMasterPurchaseLabels();
      $("masterPurchaseQuantity").focus();
    });

    box.appendChild(div);
  });

  box.style.display = matches.length ? "block" : "none";
}

function renderMaster() {
  const q = $("masterSearch").value.trim().toLowerCase();
  const container = $("masterProductCards");
  const empty = $("noMasterItems");
  const matches = products
    .filter(p => p.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));

  container.innerHTML = matches.map(p => {
    const unit = productStockUnit(p);
    const stats = calculatePurchaseStats(p);
    const weight = Number(p.weightGrams || 0);
    const packets = Number(p.packetQuantity ?? p.quantity ?? 0);
    const stock = unit === "weight"
      ? formatStockWeight(weight)
      : `${packets} packet${packets === 1 ? "" : "s"}`;
    const latestVendor = stats.history.length ? stats.history[stats.history.length - 1].vendor : "Not recorded";

    return `
      <button type="button" class="master-product-row" data-master-product-id="${p.id}">
        <span class="master-product-row-main">
          <span class="master-product-row-name">${escapeHtml(p.name)}</span>
          <span class="master-product-row-unit">${unit === "weight" ? "Weight (kg / gm)" : "Packets"}</span>
        </span>
        <span class="master-product-row-stock">
          <span>Current stock</span>
          <strong>${escapeHtml(stock)}</strong>
        </span>
        <span class="master-product-row-price">
          <span>Latest price</span>
          <strong>${stats.latestPrice == null ? "—" : money(stats.latestPrice)}</strong>
        </span>
        <span class="master-product-row-vendor">
          <span>Vendor</span>
          <strong title="${escapeHtml(latestVendor)}">${escapeHtml(latestVendor)}</strong>
        </span>
        <span class="master-product-row-arrow">›</span>
      </button>
    `;
  }).join("");

  empty.style.display = matches.length ? "none" : "block";

  container.querySelectorAll("[data-master-product-id]").forEach(row => {
    row.addEventListener("click", () => openMasterProductDialog(row.dataset.masterProductId));
  });
}

function openMasterProductDialog(productId) {
  const product = products.find(p => String(p.id) === String(productId));
  if (!product) return;

  const unit = productStockUnit(product);
  const stats = calculatePurchaseStats(product);
  const weight = Number(product.weightGrams || 0);
  const packets = Number(product.packetQuantity ?? product.quantity ?? 0);
  const latest = stats.history.length ? stats.history[stats.history.length - 1] : null;

  $("masterDialogTitle").textContent = product.name;
  $("masterDialogUnit").textContent = unit === "weight" ? "Weight (kg / gm)" : "Packets";

  const historyRows = stats.history.length
    ? stats.history.slice().reverse().map((entry, reverseIndex) => {
        const purchaseNumber = stats.history.length - reverseIndex;
        const quantity = unit === "weight"
          ? formatStockWeight(entry.weightGrams || entry.basisQuantity)
          : `${entry.packetQuantity || entry.basisQuantity} packet${Number(entry.packetQuantity || entry.basisQuantity) === 1 ? "" : "s"}`;
        const date = entry.createdAt ? new Date(entry.createdAt).toLocaleDateString("en-IN") : "—";
        return `
          <tr>
            <td>${purchaseNumber}</td>
            <td>${escapeHtml(quantity)}</td>
            <td>${money(entry.price)}</td>
            <td>${escapeHtml(entry.vendor || "Not recorded")}</td>
            <td>${date}</td>
          </tr>
        `;
      }).join("")
    : `<tr><td colspan="5" class="empty">No purchase history recorded.</td></tr>`;

  $("masterDialogBody").innerHTML = `
    <div class="master-dialog-stats">
      <div class="master-dialog-stat highlight">
        <span>Current stock</span>
        <strong>${unit === "weight" ? formatStockWeight(weight) : `${packets} packet${packets === 1 ? "" : "s"}`}</strong>
      </div>
      <div class="master-dialog-stat">
        <span>Unit of measurement</span>
        <strong>${unit === "weight" ? "Weight (kg)" : "Packets"}</strong>
      </div>
      <div class="master-dialog-stat">
        <span>Previous price</span>
        <strong>${stats.previousPrice == null ? "—" : money(stats.previousPrice)}</strong>
      </div>
      <div class="master-dialog-stat">
        <span>Latest price</span>
        <strong>${stats.latestPrice == null ? "—" : money(stats.latestPrice)}</strong>
      </div>
      <div class="master-dialog-stat">
        <span>Weighted average</span>
        <strong>${money(stats.weightedAverage)}</strong>
      </div>
      <div class="master-dialog-stat">
        <span>Latest vendor</span>
        <strong>${escapeHtml(latest ? latest.vendor : "Not recorded")}</strong>
      </div>
    </div>

    <div class="master-dialog-section-title">
      <div>
        <h4>Purchase history</h4>
        <p>${stats.history.length} recorded purchase${stats.history.length === 1 ? "" : "s"}. Old prices remain unchanged.</p>
      </div>
    </div>
    <div class="table-wrap master-dialog-history-wrap">
      <table class="master-history-table">
        <thead><tr><th>#</th><th>Quantity</th><th>Price</th><th>Vendor</th><th>Date</th></tr></thead>
        <tbody>${historyRows}</tbody>
      </table>
    </div>
    <div class="master-dialog-actions">
      <button type="button" class="danger" id="masterDeleteProductBtn">Delete Product / Stock</button>
    </div>
  `;

  $("masterDeleteProductBtn").addEventListener("click", () => deleteMasterProduct(product.id));

  $("masterProductDialog").classList.remove("hidden");
  document.body.classList.add("dialog-open");
}

async function deleteMasterProduct(productId) {
  const product = products.find(p => String(p.id) === String(productId));
  if (!product) return;

  const confirmed = confirm(
    `Delete "${product.name}" from stock?\n\nThis will remove the product and its purchase history from the product master.`
  );
  if (!confirmed) return;

  try {
    if (!firebaseReady) {
      products = products.filter(p => String(p.id) !== String(productId));
      closeMasterProductDialog();
      renderInventory();
      renderMaster();
      toast("Product deleted from stock.");
      return;
    }

    await db.ref(`products/${productId}`).remove();
    closeMasterProductDialog();
    await loadProducts();
    toast("Product deleted from stock.");
  } catch (err) {
    console.error(err);
    toast(err.message || "Could not delete product.");
  }
}

function closeMasterProductDialog() {
  $("masterProductDialog").classList.add("hidden");
  document.body.classList.remove("dialog-open");
}

function setMasterSubpage(page) {
  const pages = {
    overview: $("masterOverview"),
    product: $("masterProductPage"),
    purchase: $("masterPurchasePage")
  };

  Object.entries(pages).forEach(([key, el]) => {
    el.classList.toggle("active", key === page);
  });

  document.querySelectorAll(".master-subtab").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.masterPage === page);
  });

  if (page === "purchase") updateMasterPurchaseLabels();
}


async function saveMasterProduct() {
  const name = $("masterProductName").value.trim();
  const stockUnit = $("masterProductUnit").value;

  if (!name) return toast("Enter a product name.");
  if (findProductByName(name)) return toast(`"${name}" already exists.`);

  const now = Date.now();
  const productData = {
    name,
    nameLower: name.toLowerCase(),
    stockUnit,
    weightGrams: 0,
    packetQuantity: 0,
    quantity: 0,
    weightedAvgPurchasePrice: 0,
    purchasePrice: 0,
    priceHistory: [],
    updatedAt: now
  };

  try {
    if (!firebaseReady) {
      products.push({ id: crypto.randomUUID(), ...productData });
      products.sort((a, b) => a.name.localeCompare(b.name));
      renderInventory();
      renderMaster();
      clearMasterProductForm();
      setMasterSubpage("overview");
      toast("Product created.");
      return;
    }

    const snapshot = await db.ref("products").once("value");
    const data = snapshot.val() || {};
    const duplicate = Object.values(data).some(
      p => p && String(p.nameLower || "").toLowerCase() === name.toLowerCase()
    );
    if (duplicate) return toast(`"${name}" already exists.`);

    const id = db.ref("products").push().key;
    await db.ref(`products/${id}`).set(productData);
    await loadProducts();
    clearMasterProductForm();
    setMasterSubpage("overview");
    toast("Product created.");
  } catch (err) {
    console.error(err);
    toast(err.message || "Could not create product.");
  }
}

async function saveMasterPurchase() {
  const name = $("masterPurchaseProduct").value.trim();
  const quantity = Number($("masterPurchaseQuantity").value || 0);
  const purchasePrice = Number($("masterPurchasePrice").value);
  const vendor = $("masterVendor").value.trim();
  const existing = findProductByName(name);

  if (!existing) return toast("Select an existing product.");
  if (quantity <= 0 || Number.isNaN(quantity)) return toast("Enter a valid quantity.");
  if (purchasePrice < 0 || Number.isNaN(purchasePrice)) return toast("Enter a valid purchase price.");
  if (!vendor) return toast("Enter the vendor name.");

  const stockUnit = productStockUnit(existing);
  if (stockUnit === "packet" && !Number.isInteger(quantity)) {
    return toast("Packet quantity must be a whole number.");
  }

  // Keep the purchase history basis in the same unit as its price: kg for weight, packets for packets.
  const basisReceived = stockUnit === "weight" ? roundNumber(quantity, 3) : Math.round(quantity);
  const weightGramsReceived = stockUnit === "weight" ? weightKgToGrams(quantity) : 0;
  const packetsReceived = stockUnit === "packet" ? Math.round(quantity) : 0;

  const purchase = {
    price: roundNumber(purchasePrice, 2),
    basisQuantity: basisReceived,
    stockUnit,
    weightGrams: weightGramsReceived,
    packetQuantity: packetsReceived,
    vendor,
    createdAt: Date.now()
  };

  try {
    const existingHistory = normalizedPurchaseHistory(existing);
    const history = [...existingHistory, purchase];
    const totalBasis = history.reduce((sum, entry) => sum + Math.max(0, Number(entry.basisQuantity || 0)), 0);
    const totalCost = history.reduce(
      (sum, entry) => sum + Math.max(0, Number(entry.basisQuantity || 0)) * Number(entry.price || 0),
      0
    );
    const weightedAverage = totalBasis > 0 ? roundNumber(totalCost / totalBasis, 2) : purchasePrice;
    const nextWeight = normalizeWeightGrams(existing.weightGrams || 0) + weightGramsReceived;
    const nextPackets = Number(existing.packetQuantity ?? existing.quantity ?? 0) + packetsReceived;

    const updates = {
      stockUnit,
      weightGrams: nextWeight,
      packetQuantity: nextPackets,
      quantity: nextPackets,
      weightedAvgPurchasePrice: weightedAverage,
      purchasePrice: roundNumber(purchasePrice, 2),
      priceHistory: history,
      updatedAt: Date.now()
    };

    if (!firebaseReady) {
      Object.assign(existing, updates);
      renderInventory();
      renderMaster();
      clearMasterPurchaseForm();
      setMasterSubpage("overview");
      toast("Purchase saved. Price history updated.");
      return;
    }

    await db.ref(`products/${existing.id}`).update(updates);
    await loadProducts();
    clearMasterPurchaseForm();
    setMasterSubpage("overview");
    toast("Purchase saved. Price history updated.");
  } catch (err) {
    console.error(err);
    toast(err.message || "Could not save purchase.");
  }
}

document.querySelectorAll(".master-subtab").forEach(tab => {
  tab.addEventListener("click", () => setMasterSubpage(tab.dataset.masterPage));
});

document.querySelectorAll("[data-close-master-dialog]").forEach(el => {
  el.addEventListener("click", closeMasterProductDialog);
});

document.addEventListener("keydown", e => {
  if (e.key === "Escape" && !$("masterProductDialog").classList.contains("hidden")) {
    closeMasterProductDialog();
  }
});

$("masterProductSaveBtn").addEventListener("click", saveMasterProduct);
$("masterProductClearBtn").addEventListener("click", clearMasterProductForm);
$("masterPurchaseSaveBtn").addEventListener("click", saveMasterPurchase);
$("masterPurchaseClearBtn").addEventListener("click", clearMasterPurchaseForm);
$("masterSearch").addEventListener("input", renderMaster);
$("masterPurchaseProduct").addEventListener("input", () => {
  renderMasterPurchaseSuggestions();
  updateMasterPurchaseLabels();
});

$("masterPurchaseProduct").addEventListener("focus", () => {
  renderMasterPurchaseSuggestions();
  updateMasterPurchaseLabels();
});

document.addEventListener("click", e => {
  if (!e.target.closest("#masterPurchaseProduct") && !e.target.closest("#masterPurchaseSuggestions")) {
    $("masterPurchaseSuggestions").style.display = "none";
  }
});

function masterNormalizeProduct(product) {
  const normalized = {
    ...product,
    stockUnit: product.stockUnit || "packet",
    packetQuantity: Number(product.packetQuantity ?? product.quantity ?? 0),
    weightGrams: normalizeWeightGrams(product.weightGrams ?? 0),
    weightedAvgPurchasePrice: product.weightedAvgPurchasePrice != null
      ? Number(product.weightedAvgPurchasePrice)
      : Number(product.purchasePrice || 0),
    priceHistory: Array.isArray(product.priceHistory) ? product.priceHistory : []
  };

  // Preserve older records and make their purchase history displayable without
  // changing the live database until the next purchase is recorded.
  if (!normalized.priceHistory.length && Number(product.purchasePrice || 0) > 0) {
    const basis = productStockUnit(normalized) === "weight"
      ? roundNumber(Number(normalized.weightGrams || 0) / 1000, 3)
      : Number(normalized.packetQuantity || 0);
    normalized.priceHistory = [{
      price: Number(product.purchasePrice || 0),
      basisQuantity: basis,
      stockUnit: normalized.stockUnit,
      weightGrams: Number(normalized.weightGrams || 0),
      packetQuantity: Number(normalized.packetQuantity || 0),
      vendor: "Not recorded",
      createdAt: Number(product.updatedAt || 0)
    }];
  }

  return normalized;
}

async function loadProducts() {
  if (!firebaseReady) {
    products = products.map(masterNormalizeProduct).sort((a, b) => a.name.localeCompare(b.name));
    renderInventory();
    renderMaster();
    return;
  }

  const snapshot = await db.ref("products").once("value");
  const data = snapshot.val() || {};

  products = Object.entries(data)
    .map(([id, value]) => masterNormalizeProduct({ id, ...value }))
    .sort((a, b) => a.name.localeCompare(b.name));

  renderInventory();
  renderMaster();
}

// REPORTS
function localDateInputValue(date = new Date()) {
  const y=date.getFullYear(), m=String(date.getMonth()+1).padStart(2,"0"), d=String(date.getDate()).padStart(2,"0");
  return `${y}-${m}-${d}`;
}
function billsForDate(dateString) {
  const [year,month,day]=dateString.split("-").map(Number);
  return bills.filter(b=>{const d=new Date(Number(b.createdAt||0));return d.getFullYear()===year&&d.getMonth()+1===month&&d.getDate()===day;});
}
function renderReports() {
  if (!$("reportDate")) return;
  if (!$("reportDate").value) $("reportDate").value=localDateInputValue();
  const selected=billsForDate($("reportDate").value);
  const sales=selected.reduce((s,b)=>s+Number(b.total||0),0);
  const discounts=selected.reduce((s,b)=>s+Number(b.discount||0),0);
  $("reportSales").textContent=money(sales); $("reportBills").textContent=selected.length;
  $("reportDiscounts").textContent=money(discounts); $("reportAverage").textContent=money(selected.length?sales/selected.length:0);

  const map={};
  selected.forEach(b=>(b.items||[]).forEach(i=>{const n=String(i.name||"").trim();if(!n)return;if(!map[n])map[n]={name:n,qty:0,sales:0};map[n].qty+=Number(i.qty||0);map[n].sales+=Number(i.qty||0)*Number(i.price||0);}));
  const top=Object.values(map).sort((a,b)=>b.qty-a.qty||b.sales-a.sales).slice(0,10);
  $("topProducts").innerHTML=top.map(i=>`<tr><td>${escapeHtml(i.name)}</td><td>${i.qty}</td><td>${money(i.sales)}</td></tr>`).join("");
  $("noTopProducts").style.display=top.length?"none":"block";

  const sorted=[...selected].sort((a,b)=>Number(a.createdAt||0)-Number(b.createdAt||0));
  $("reportBillList").innerHTML=sorted.map(b=>`<tr><td>${escapeHtml(b.billNumber||"")}</td><td>${new Date(Number(b.createdAt||0)).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}</td><td>${money(b.total)}</td></tr>`).join("");
  $("noReportBills").style.display=sorted.length?"none":"block";
}
$("todayReportBtn").addEventListener("click",()=>{$("reportDate").value=localDateInputValue();renderReports();});
$("loadReportBtn").addEventListener("click",renderReports);
$("reportDate").addEventListener("change",renderReports);


// BACKUP & EXPORT
function downloadTextFile(filename, text, mimeType) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function makeInventoryCsv() {
  const rows = [["Product", "Quantity", "Unit of Measurement", "Updated At"]];
  products.forEach(p => {
    const unit = productStockUnit(p);
    rows.push([
      p.name,
      unit === "weight" ? formatStockWeight(p.weightGrams) : Number(p.packetQuantity ?? p.quantity ?? 0),
      unit === "weight" ? "Weight" : "Packets",
      p.updatedAt ? new Date(Number(p.updatedAt)).toLocaleString("en-IN") : ""
    ]);
  });
  return rows.map(row => row.map(csvEscape).join(",")).join("\r\n");
}

function makeSalesCsv() {
  const rows = [["Bill Number", "Date", "Product", "Quantity", "Price", "Item Total", "Subtotal", "Discount", "Total"]];
  bills.forEach(bill => {
    const items = bill.items || [];
    if (!items.length) {
      rows.push([
        bill.billNumber,
        new Date(Number(bill.createdAt || 0)).toLocaleString("en-IN"),
        "",
        "",
        "",
        "",
        bill.subtotal,
        bill.discount,
        bill.total
      ]);
      return;
    }

    items.forEach(item => {
      rows.push([
        bill.billNumber,
        new Date(Number(bill.createdAt || 0)).toLocaleString("en-IN"),
        item.name,
        item.qty,
        item.price,
        Number(item.price || 0),
        bill.subtotal,
        bill.discount,
        bill.total
      ]);
    });
  });
  return rows.map(row => row.map(csvEscape).join(",")).join("\r\n");
}

function downloadFullBackup() {
  const backup = {
    format: "family-store-billing-backup",
    version: 2,
    exportedAt: new Date().toISOString(),
    settings: storeSettings,
    products: products,
    bills: bills
  };

  const date = localDateInputValue();
  downloadTextFile(
    `family-store-backup-${date}.json`,
    JSON.stringify(backup, null, 2),
    "application/json;charset=utf-8"
  );
  toast("Full backup downloaded.");
}

$("downloadBackupBtn").addEventListener("click", downloadFullBackup);

$("downloadInventoryBtn").addEventListener("click", () => {
  downloadTextFile(
    `inventory-${localDateInputValue()}.csv`,
    makeInventoryCsv(),
    "text/csv;charset=utf-8"
  );
  toast("Inventory CSV downloaded.");
});

$("downloadSalesBtn").addEventListener("click", () => {
  downloadTextFile(
    `sales-${localDateInputValue()}.csv`,
    makeSalesCsv(),
    "text/csv;charset=utf-8"
  );
  toast("Sales CSV downloaded.");
});

// SETTINGS
async function loadSettings() {
  if (!firebaseReady) {
    renderSettings();
    return;
  }

  try {
    const snapshot = await db.ref("settings/store").once("value");
    const data = snapshot.val();

    if (data) {
      storeSettings = {
        name: data.name || "Family Store",
        address: data.address || "",
        phone: data.phone || "",
        receiptWidth: Number(data.receiptWidth) || 58
      };
    }

    renderSettings();
  } catch (err) {
    console.error(err);
    toast("Could not load store settings.");
  }
}

function renderSettings() {
  $("storeName").value = storeSettings.name || "";
  $("storeAddress").value = storeSettings.address || "";
  $("storePhone").value = storeSettings.phone || "";
  $("receiptWidth").value = String(storeSettings.receiptWidth || 58);
}

$("saveSettingsBtn").addEventListener("click", async () => {
  const data = {
    name: $("storeName").value.trim() || "Family Store",
    address: $("storeAddress").value.trim(),
    phone: $("storePhone").value.trim(),
    receiptWidth: Number($("receiptWidth").value) === 80 ? 80 : 58
  };

  try {
    if (firebaseReady) {
      await db.ref("settings/store").set(data);
    }

    storeSettings = data;
    toast("Store settings saved.");
  } catch (err) {
    console.error(err);
    toast("Could not save store settings.");
  }
});

// BILL HISTORY
async function loadBills() {
  if (!firebaseReady) {
    renderHistory();
    return;
  }

  const snapshot = await db.ref("bills").once("value");
  const data = snapshot.val() || {};

  bills = Object.entries(data)
    .map(([id, value]) => ({ id, ...value }))
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
    .slice(0, 100);

  renderHistory();
}

function renderHistory() {
  const q = $("historySearch").value.trim().toLowerCase();
  const body = $("historyItems");
  body.innerHTML = "";

  bills
    .filter(b =>
      String(b.billNumber).toLowerCase().includes(q) ||
      (b.items || []).some(i => String(i.name).toLowerCase().includes(q))
    )
    .forEach(b => {
      const tr = document.createElement("tr");

      tr.innerHTML = `
        <td>${escapeHtml(b.billNumber)}</td>
        <td>${formatDate(b.createdAt)}</td>
        <td>${(b.items || []).length}</td>
        <td>${money(b.total)}</td>
        <td>
          <button class="secondary reprint-btn" data-id="${b.id}">
            View / Print
          </button>
        </td>
      `;

      body.appendChild(tr);
    });

  body.querySelectorAll(".reprint-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const b = bills.find(x => x.id === btn.dataset.id);
      if (b) printBill(b);
    });
  });
}

$("historySearch").addEventListener("input", renderHistory);

document.querySelectorAll("[data-close]").forEach(btn => {
  btn.addEventListener("click", () => {
    $(btn.dataset.close).classList.add("hidden");
  });
});

function formatDate(value) {
  if (!value) return "—";
  return new Date(Number(value)).toLocaleString("en-IN");
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[c]));
}

updateBillUnitFields();
updateMasterPurchaseLabels();
initFirebase();
if ($("reportDate")) $("reportDate").value=localDateInputValue();
renderBill();
