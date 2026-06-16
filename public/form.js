const PRODUCTS = [
  { id: 'entity_filing',        label: 'Entity Filing (LLC)',                hasNote: false },
  { id: 'office_supplies',      label: 'Office Supplies ', hasNote: false },
  { id: 'credit_boost',         label: 'Credit Boost',                       hasNote: false },
  { id: 'biz_funding',          label: 'Business Funding Application',        hasNote: false },
  { id: 'hosting',              label: 'Hosting',                            hasNote: true,  notePlaceholder: 'Specify terms...' },
  { id: 'domain',               label: 'Custom Domain Name',                 hasNote: false },
  { id: 'consultation',         label: 'Business Consultation',              hasNote: false },
  { id: 'orientation',          label: 'Orientation Training',               hasNote: false },
  { id: 'ai_bot',               label: 'A.I Bot',                           hasNote: false },
  { id: 'product_upgrade',      label: 'Product Upgrade',                    hasNote: true,  notePlaceholder: 'Specify terms...' },
  { id: 'streaming_commercial', label: 'Streaming Commercial',               hasNote: true,  notePlaceholder: 'Specify terms...' },
  { id: 'ad_campaign',          label: 'Advertisement Campaign',             hasNote: true,  notePlaceholder: 'Specify ad views / terms...' },
  { id: 'other',                label: 'Other',                              hasNote: true,  notePlaceholder: 'Specify...' },
];

let formCount    = 0;
let activeFormId = null;
let submissions  = [];

document.addEventListener('DOMContentLoaded', () => { showHome(); });

// ── Views ─────────────────────────────────────────────────
function showHome() {
  activeFormId = null;
  document.getElementById('view-home').style.display   = 'block';
  document.getElementById('view-form').style.display   = 'none';
  document.getElementById('view-detail').style.display = 'none';
  renderSessionList();
}

function showForm(prefillJson) {
  document.getElementById('view-home').style.display   = 'none';
  document.getElementById('view-form').style.display   = 'block';
  document.getElementById('view-detail').style.display = 'none';
  formCount++;
  activeFormId = formCount;
  const prefill = prefillJson ? JSON.parse(prefillJson) : {};
  // Pre-fill rep name from logged in account if not already set
  if (!prefill.salesRep && window._repName) {
    prefill.salesRep = window._repName;
  }
  buildForm(activeFormId, prefill);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showDetail(index) {
  const s = submissions[index];
  if (!s) return;
  document.getElementById('view-home').style.display   = 'none';
  document.getElementById('view-form').style.display   = 'none';
  document.getElementById('view-detail').style.display = 'block';

  document.getElementById('detail-body').innerHTML = `
    <div class="detail-row"><span class="detail-label">Sales Rep</span><span>${esc(s.salesRep||'—')}</span></div>
    <div class="detail-row"><span class="detail-label">Customer</span><span>${esc(s.customerName||'—')}</span></div>
    <div class="detail-row"><span class="detail-label">Address</span><span>${esc(s.customerAddress||'—')}</span></div>
    <div class="detail-row"><span class="detail-label">City / ZIP</span><span>${esc(s.customerCity||'—')}</span></div>
    <div class="detail-row"><span class="detail-label">Email</span><span>${esc(s.customerEmail||'—')}</span></div>
    <div class="detail-row"><span class="detail-label">Company</span><span>${esc(s.saleCompany||'—')}</span></div>
    <div class="detail-row"><span class="detail-label">Products</span><span>${esc((s.products||[]).join(', ')||'—')}</span></div>
    <div class="detail-row"><span class="detail-label">Amount</span><span>${esc(s.transactionAmount||'—')}</span></div>
    <div class="detail-row"><span class="detail-label">Payment</span><span>${esc(s.paymentNum)} of ${esc(s.paymentOf)} · ${esc(s.paymentMethod||'—')}${s.cardLast4?' · xxxx-'+esc(s.cardLast4):''}</span></div>
    <div class="detail-row"><span class="detail-label">Payment Plan</span><span>${esc(s.paymentPlan||'—')}</span></div>
    <div class="detail-row"><span class="detail-label">Rebate</span><span>${esc(s.rebateDiscount||'—')}</span></div>
    <div class="detail-row"><span class="detail-label">Sales Notes</span><span>${esc(s.salesNotes||'—')}</span></div>
    <div class="detail-row"><span class="detail-label">Submitted</span><span>${s.time||'—'}</span></div>
  `;
  document.getElementById('detail-pdf-link').href = '/pdfs/' + encodeURIComponent(s.filename);
  document.getElementById('detail-dup-btn').onclick = () => showForm(JSON.stringify(s));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Home session list ─────────────────────────────────────
function renderSessionList() {
  const list = document.getElementById('session-list');
  if (submissions.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📋</div>
        <p>No receipts submitted yet this session.</p>
        <p style="font-size:13px;color:#aaa;margin-top:4px">Tap a submitted receipt to view its details.</p>
      </div>`;
    return;
  }
  list.innerHTML = submissions.map((s, i) => `
    <div class="session-item" onclick="showDetail(${i})">
      <div class="session-info">
        <div class="session-name">${esc(s.customerName)} <span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;background:${(s.signatureStatus||'unsigned')==='signed'?'#d4edda':(s.signatureStatus||'unsigned')==='sent'?'#fff3cd':'#f0f0f0'};color:${(s.signatureStatus||'unsigned')==='signed'?'#155724':(s.signatureStatus||'unsigned')==='sent'?'#856404':'#888'}">${((s.signatureStatus||'unsigned').charAt(0).toUpperCase()+(s.signatureStatus||'unsigned').slice(1))}</span></div>
        <div class="session-meta">${esc(s.saleCompany)} &nbsp;·&nbsp; ${esc(s.transactionAmount||'—')} &nbsp;·&nbsp; ${s.time||''}</div>
        <div class="session-products">${esc((s.products||[]).join(', '))}</div>
      </div>
      <div class="session-actions" onclick="event.stopPropagation()">
        <a class="btn-small-pdf" href="/api/pdf/${s.id}" target="_blank">⬇ Signed PDF</a>
        <a class="btn-small-pdf" href="/api/pdf/original/${s.id}" target="_blank" style="background:#555">📄 Unsigned PDF</a>
        <button class="btn-small-dup" onclick="markLinkSent('${s.id}', this)" ${s.linkSentAt?'disabled':''} style="font-size:11px">${s.linkSentAt?'📤 Sent '+new Date(s.linkSentAt).toLocaleDateString('en-US',{month:'short',day:'numeric'}):'📤 Mark Sent'}</button>
        <button class="btn-small-dup" onclick="showForm(${JSON.stringify(JSON.stringify(s))})">Duplicate</button>
      </div>
    </div>
  `).join('');
}

// ── Build form ────────────────────────────────────────────
function buildForm(id, prefill) {
  document.getElementById('form-wrap').innerHTML = `
    <div class="steps">
      <div class="step active" id="step-dot-1">1</div>
      <div class="step-line"></div>
      <div class="step" id="step-dot-2">2</div>
      <div class="step-line"></div>
      <div class="step" id="step-dot-3">3</div>
      <div class="step-line"></div>
      <div class="step" id="step-dot-4">4</div>
    </div>

    <!-- STEP 1: Customer & Company -->
    <div class="form-step" id="step-1">
      <h2 class="step-title">Customer & Company</h2>

      <div class="field-group">
        <label>Sales Rep Name <span class="req">*</span></label>
        <p class="hint">Your full name</p>
        <input type="text" id="salesRep-${id}" placeholder="Your name" value="${esc(prefill.salesRep||'')}">
        <span class="err" id="err-rep-${id}">Sales rep name is required.</span>
      </div>

      <div class="field-group">
        <label>Sale Date</label>
        <p class="hint">Defaults to today — change if needed</p>
        <input type="date" id="saleDate-${id}" value="${prefill.saleDate || new Date().toISOString().slice(0,10)}">
      </div>

      <div class="field-group">
        <label>Customer Name <span class="req">*</span></label>
        <p class="hint">Copy and paste from customer profile for correct spelling</p>
        <input type="text" id="customerName-${id}" placeholder="Full name" value="${esc(prefill.customerName||'')}">
        <span class="err" id="err-name-${id}">Customer name is required.</span>
      </div>

      <div class="field-group">
        <label>Street Address</label>
        <input type="text" id="customerAddress-${id}" placeholder="e.g. 123 Main St" value="${esc(prefill.customerAddress||'')}">
      </div>

      <div class="two-col">
        <div class="field-group">
          <label>City, State ZIP</label>
          <input type="text" id="customerCity-${id}" placeholder="e.g. Phoenix AZ 85001" value="${esc(prefill.customerCity||'')}">
        </div>
        <div class="field-group">
          <label>Email</label>
          <input type="text" id="customerEmail-${id}" placeholder="e.g. john@email.com" value="${esc(prefill.customerEmail||'')}">
        </div>
      </div>

      <div class="field-group">
        <label>Sale Company <span class="req">*</span></label>
        <div class="choice-grid">
          ${['IOS','Limitless','Other'].map(co => `
            <label class="choice-card ${prefill.saleCompany===co?'selected':''}">
              <input type="radio" name="saleCompany-${id}" value="${co}"
                ${prefill.saleCompany===co?'checked':''}
                onchange="onCompanyChange(${id})">
              <span class="choice-label">${co}</span>
            </label>
          `).join('')}
        </div>

        <div class="reveal ${prefill.saleCompany==='Other'?'visible':''}" id="other-co-${id}">
          <input type="text" placeholder="Company name..." value="${esc(prefill.saleCompanyOther||'')}">
        </div>
        <span class="err" id="err-company-${id}">Please select a sale company.</span>
      </div>

      <div class="step-nav">
        <button class="btn-back-home" onclick="showHome()">← Back</button>
        <button class="btn-next" onclick="goStep(${id},1,2)">Next →</button>
      </div>
    </div>

    <!-- STEP 2: Products -->
    <div class="form-step hidden" id="step-2">
      <h2 class="step-title">Products Purchased</h2>
      <p class="hint" style="margin-bottom:16px">Tap everything that applies to this sale</p>
      <div class="product-grid">
        ${PRODUCTS.map(p => `
          <label class="product-card ${(prefill.products||[]).includes(p.label)?'selected':''}">
            <input type="checkbox" id="${p.id}-${id}" value="${p.label}"
              ${(prefill.products||[]).includes(p.label)?'checked':''}
              onchange="onProductChange('${p.id}',${id},${p.hasNote})">
            <span class="product-label">${p.label}</span>
            ${p.hasNote ? `<input type="text" class="product-note ${(prefill.products||[]).includes(p.label)?'visible':''}" id="note-${p.id}-${id}" placeholder="${p.notePlaceholder}" value="${esc((prefill.productNotes&&prefill.productNotes[p.label])||'')}">` : ''}
          </label>
        `).join('')}
      </div>
      <span class="err" id="err-products-${id}">Please select at least one product.</span>
      <div class="step-nav">
        <button class="btn-back" onclick="goStep(${id},2,1)">← Back</button>
        <button class="btn-next" onclick="goStep(${id},2,3)">Next →</button>
      </div>
    </div>

    <!-- STEP 3: Payment -->
    <div class="form-step hidden" id="step-3">
      <h2 class="step-title">Payment Details</h2>

      <div class="two-col">
        <div class="field-group">
          <label>Payment Number</label>
          <p class="hint">Which payment is this?</p>
          <div class="inline-fields">
            <input type="text" id="paymentNum-${id}" placeholder="1" value="${esc(prefill.paymentNum||'1')}" style="width:60px;text-align:center">
            <span class="of-label">of</span>
            <input type="text" id="paymentOf-${id}" placeholder="1" value="${esc(prefill.paymentOf||'1')}" style="width:60px;text-align:center">
          </div>
        </div>
        <div class="field-group">
          <label>Transaction Amount</label>
          <p class="hint">This payment only</p>
          <input type="text" id="amount-${id}" placeholder="e.g. $500" value="${esc(prefill.transactionAmount||'')}">
        </div>
      </div>

      <div class="field-group">
        <label>Payment Method</label>
        <div class="choice-grid">
          ${['Credit Card','Debit Card','Cash','Check','Other'].map(m => `
            <label class="choice-card ${prefill.paymentMethod===m?'selected':''}">
              <input type="radio" name="payMethod-${id}" value="${m}"
                ${prefill.paymentMethod===m?'checked':''}
                onchange="onMethodChange(${id})">
              <span class="choice-label">${m}</span>
            </label>
          `).join('')}
        </div>
      </div>

      <div class="reveal ${(prefill.paymentMethod==='Credit Card'||prefill.paymentMethod==='Debit Card')?'visible':''}" id="card-fields-${id}">
        <div class="two-col">
          <div class="field-group">
            <label>Last 4 Digits</label>
            <input type="text" id="cardLast4-${id}" placeholder="e.g. 4321" maxlength="4"
              inputmode="numeric"
              value="${esc(prefill.cardLast4||'')}"
              oninput="this.value=this.value.replace(/[^0-9]/g,'').slice(0,4)">
          </div>
          <div class="field-group">
            <label>Expiration Date</label>
            <input type="text" id="cardExp-${id}" placeholder="MM/YY" maxlength="5"
              inputmode="numeric"
              value="${esc(prefill.cardExp||'')}"
              oninput="formatExpDate(this)">
          </div>
        </div>
      </div>

      <div class="field-group">
        <label>Rebate or Discount</label>
        <p class="hint">Internal only — will not appear on PDF</p>
        <input type="text" id="rebate-${id}" placeholder="e.g. $50 rebate on hosting" value="${esc(prefill.rebateDiscount||'')}">
      </div>

      <div class="field-group">
        <label>Payment Plan / Notes</label>
        <p class="hint">Appears on PDF under Payment Arrangement</p>
        <textarea id="plan-${id}" rows="3" placeholder="e.g. Total=$1000, Current=$600, $200/month, Next payment Feb 15">${esc(prefill.paymentPlan||'')}</textarea>
      </div>

      <div class="step-nav">
        <button class="btn-back" onclick="goStep(${id},3,2)">← Back</button>
        <button class="btn-next" onclick="goStep(${id},3,4)">Next →</button>
      </div>
    </div>

    <!-- STEP 4: Notes & Submit -->
    <div class="form-step hidden" id="step-4">
      <h2 class="step-title">Notes & Submit</h2>

      <div class="field-group">
        <label>Sales Notes</label>
        <p class="hint">Internal only — will not appear on PDF</p>
        <textarea id="notes-${id}" rows="4" placeholder="Any additional notes for your records...">${esc(prefill.salesNotes||'')}</textarea>
      </div>

      <div class="summary-card" id="summary-${id}"></div>

      <div class="step-nav" style="flex-direction:column;gap:10px">
        <button class="btn-submit" id="submit-btn-${id}" onclick="submitForm(${id})">
          Submit &amp; Generate PDF
        </button>
        <button class="btn-back" onclick="goStep(${id},4,3)" style="width:100%">← Back</button>
      </div>
    </div>
  `;
}

// ── Exp date auto-format MM/YY ────────────────────────────
function formatExpDate(input) {
  let val = input.value.replace(/[^0-9]/g, '').slice(0, 4);
  if (val.length >= 3) {
    val = val.slice(0, 2) + '/' + val.slice(2);
  }
  input.value = val;
}

// ── Step nav ──────────────────────────────────────────────
function goStep(id, from, to) {
  if (to > from && !validateStep(id, from)) return;
  document.getElementById('step-' + from).classList.add('hidden');
  document.getElementById('step-' + to).classList.remove('hidden');
  for (let i = 1; i <= 4; i++) {
    const dot = document.getElementById('step-dot-' + i);
    dot.classList.remove('active', 'done');
    if (i < to) dot.classList.add('done');
    if (i === to) dot.classList.add('active');
  }
  if (to === 4) buildSummary(id);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function validateStep(id, step) {
  clearErrors(id);
  let ok = true;
  if (step === 1) {
    if (!document.getElementById('salesRep-' + id)?.value.trim()) { show('err-rep-' + id); ok = false; }
    if (!document.getElementById('customerName-' + id)?.value.trim()) { show('err-name-' + id); ok = false; }
    if (!document.querySelector(`input[name="saleCompany-${id}"]:checked`)) { show('err-company-' + id); ok = false; }
  }
  if (step === 2) {
    const checked = PRODUCTS.filter(p => document.getElementById(p.id + '-' + id)?.checked);
    if (checked.length === 0) { show('err-products-' + id); ok = false; }
  }
  if (!ok) window.scrollTo({ top: 0, behavior: 'smooth' });
  return ok;
}

function clearErrors(id) {
  ['err-rep','err-name','err-company','err-products'].forEach(e => {
    const el = document.getElementById(e + '-' + id);
    if (el) el.style.display = 'none';
  });
}
function show(elId) { const el = document.getElementById(elId); if (el) el.style.display = 'block'; }

function buildSummary(id) {
  const d  = collectFormData(id);
  const el = document.getElementById('summary-' + id);
  if (!el) return;
  el.innerHTML = `
    <div class="summary-row"><span class="summary-label">Sales Rep</span><span>${esc(d.salesRep||'—')}</span></div>
    <div class="summary-row"><span class="summary-label">Sales Rep</span><span>${esc(d.salesRep||'—')}</span></div>
    <div class="summary-row"><span class="summary-label">Customer</span><span>${esc(d.customerName||'—')}</span></div>
    <div class="summary-row"><span class="summary-label">Address</span><span>${esc(d.customerAddress||'—')}</span></div>
    <div class="summary-row"><span class="summary-label">City / ZIP</span><span>${esc(d.customerCity||'—')}</span></div>
    <div class="summary-row"><span class="summary-label">Email</span><span>${esc(d.customerEmail||'—')}</span></div>
    <div class="summary-row"><span class="summary-label">Company</span><span>${esc(d.saleCompany||'—')}</span></div>
    <div class="summary-row"><span class="summary-label">Products</span><span>${esc((d.products||[]).join(', ')||'—')}</span></div>
    <div class="summary-row"><span class="summary-label">Amount</span><span>${esc(d.transactionAmount||'—')}</span></div>
    <div class="summary-row"><span class="summary-label">Payment</span><span>${esc(d.paymentNum)} of ${esc(d.paymentOf)} · ${esc(d.paymentMethod||'—')}</span></div>
  `;
}

// ── Toggles ───────────────────────────────────────────────
function onCompanyChange(id) {
  const sel = document.querySelector(`input[name="saleCompany-${id}"]:checked`);
  if (!sel) return;
  document.querySelectorAll(`input[name="saleCompany-${id}"]`).forEach(r => {
    r.closest('.choice-card').classList.toggle('selected', r.checked);
  });

  document.getElementById('other-co-' + id)?.classList.toggle('visible',  sel.value === 'Other');
}

function onMethodChange(id) {
  const sel = document.querySelector(`input[name="payMethod-${id}"]:checked`);
  if (!sel) return;
  document.querySelectorAll(`input[name="payMethod-${id}"]`).forEach(r => {
    r.closest('.choice-card').classList.toggle('selected', r.checked);
  });
  document.getElementById('card-fields-' + id)?.classList.toggle('visible',
    sel.value === 'Credit Card' || sel.value === 'Debit Card');
}

function onProductChange(productId, formId, hasNote) {
  const cb = document.getElementById(productId + '-' + formId);
  if (!cb) return;
  cb.closest('.product-card')?.classList.toggle('selected', cb.checked);
  if (hasNote) {
    document.getElementById('note-' + productId + '-' + formId)?.classList.toggle('visible', cb.checked);
  }
}

// ── Collect ───────────────────────────────────────────────
function collectFormData(id) {
  const products = [], productNotes = {};
  PRODUCTS.forEach(p => {
    const cb = document.getElementById(p.id + '-' + id);
    if (cb && cb.checked) {
      products.push(p.label);
      if (p.hasNote) {
        const ni = document.getElementById('note-' + p.id + '-' + id);
        if (ni && ni.value.trim()) productNotes[p.label] = ni.value.trim();
      }
    }
  });
  const coRadio  = document.querySelector(`input[name="saleCompany-${id}"]:checked`);
  const payRadio = document.querySelector(`input[name="payMethod-${id}"]:checked`);
  return {
    salesRep:          document.getElementById('salesRep-' + id)?.value.trim()      || '',
    salesRep:          document.getElementById('salesRep-' + id)?.value.trim()        || '',
    saleDate:          document.getElementById('saleDate-' + id)?.value || new Date().toISOString().slice(0,10),
    customerName:      document.getElementById('customerName-' + id)?.value.trim()    || '',
    customerAddress:   document.getElementById('customerAddress-' + id)?.value.trim() || '',
    customerCity:      document.getElementById('customerCity-' + id)?.value.trim()    || '',
    customerEmail:     document.getElementById('customerEmail-' + id)?.value.trim()   || '',
    products, productNotes,
    saleCompany:       coRadio?.value || '',
    saleCompanyOther:  document.querySelector('#other-co-' + id + ' input')?.value.trim() || '',
    rebateDiscount:    document.getElementById('rebate-' + id)?.value.trim()      || '',
    transactionAmount: document.getElementById('amount-' + id)?.value.trim()      || '',
    paymentNum:        document.getElementById('paymentNum-' + id)?.value.trim()  || '1',
    paymentOf:         document.getElementById('paymentOf-' + id)?.value.trim()   || '1',
    paymentMethod:     payRadio?.value || '',
    cardLast4:         document.getElementById('cardLast4-' + id)?.value.trim()   || '',
    cardExp:           document.getElementById('cardExp-' + id)?.value.trim()     || '',
    paymentPlan:       document.getElementById('plan-' + id)?.value.trim()        || '',
    salesNotes:        document.getElementById('notes-' + id)?.value.trim()       || '',
  };
}

// ── Submit ────────────────────────────────────────────────
async function submitForm(id) {
  const data = collectFormData(id);
  const btn  = document.getElementById('submit-btn-' + id);
  btn.disabled = true;
  btn.textContent = 'Generating PDF...';
  try {
    const token = window._repToken || localStorage.getItem('rp_token') || '';
    const res    = await fetch('/submit', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-session-token': token },
      body: JSON.stringify(data),
    });
    const result = await res.json();
    if (result.success) {
      const entry = {
        ...data, filename: result.filename, id: result.id,
        time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      };
      submissions.unshift(entry);
      showSuccessScreen(entry);
    } else {
      alert('Error: ' + (result.error || 'Unknown'));
      btn.disabled = false;
      btn.textContent = 'Submit & Generate PDF';
    }
  } catch (err) {
    alert('Could not reach server. Is it running?');
    btn.disabled = false;
    btn.textContent = 'Submit & Generate PDF';
  }
}

function showSuccessScreen(s) {
  document.getElementById('form-wrap').innerHTML = `
    <div class="success-screen">
      <div class="success-icon">✅</div>
      <h2>Receipt Submitted!</h2>
      <p class="success-name">${esc(s.customerName)}</p>
      <p class="success-amount">${esc(s.transactionAmount||'—')} · ${esc(s.saleCompany)}</p>
      <p class="success-file">${esc(s.filename)}</p>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-bottom:12px">
        <a class="btn-pdf-download" href="/api/pdf/${s.id}" target="_blank">⬇ Signed PDF</a>
        <a class="btn-pdf-download" href="/api/pdf/original/${s.id}" target="_blank" style="background:#555">📄 Original Receipt</a>
      </div>
      <div style="margin:12px 0;padding:12px 14px;background:#f0f7ff;border:1px solid #c0d8f0;border-radius:8px;text-align:left">
        <div style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;margin-bottom:6px">🔗 Signing Link — send to customer</div>
        <div id="success-sig-box" style="font-size:12px;color:#1a6fa8;word-break:break-all;font-family:monospace;margin-bottom:8px">Generating...</div>
        <button onclick="copySigLink()" style="padding:6px 16px;background:#2c2c2c;color:#e0c97a;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer">📋 Copy Link</button>
      </div>
      <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:16px">
        <button class="btn-ghost" onclick="duplicateFromSuccess(this)" data-entry="${esc(JSON.stringify(s))}">Duplicate Form</button>
        <button class="btn-ghost" onclick="goRepHome()">← Home</button>
      </div>
    </div>
  `;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  // Auto-generate and copy signing link
  if (s.id) {
    getSigningLinkForSubmission(s.id, s.customerName);
  }
}

var _currentSigningLink = null;

function copySigLink() {
  if (_currentSigningLink) {
    navigator.clipboard.writeText(_currentSigningLink).catch(function(){});
    alert('Copied!\n\n' + _currentSigningLink);
  }
}

function getSigningLinkForSubmission(id, name) {
  fetch('/api/send-signature/' + id, { method: 'POST', headers: {'Content-Type':'application/json'}, body: '{}' })
    .then(function(r){ return r.json(); })
    .then(function(result){
      if (result.success) {
        _currentSigningLink = result.signingLink;
        var box = document.getElementById('success-sig-box');
        if (box) { box.textContent = result.signingLink; }
        navigator.clipboard.writeText(result.signingLink).catch(function(){});
      } else {
        var box = document.getElementById('success-sig-box');
        if (box) box.textContent = 'Could not generate link.';
      }
    })
    .catch(function(){ alert('Could not reach server.'); });
}

function duplicateFromSuccess(btn) {
  try {
    const raw = btn.getAttribute('data-entry');
    showForm(raw);
  } catch(e) {
    showForm();
  }
}

var _detailSigningLink = null;

function copyDetailSigLink() {
  if (_detailSigningLink) {
    navigator.clipboard.writeText(_detailSigningLink).catch(function(){});
    alert('Copied!\n\n' + _detailSigningLink);
  }
}

function repGetSigningLink() {
  const s = submissions.find(function(x){ return x.filename && document.getElementById('detail-pdf-link').href.includes(x.id); }) ||
            allPast.find(function(x){ return document.getElementById('detail-pdf-link').href.includes(x.id); });
  const id = s ? s.id : null;
  if (!id) return;
  fetch('/api/send-signature/' + id, { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' })
    .then(function(r){ return r.json(); })
    .then(function(result){
      if (result.success) {
        const full = result.signingLink;
        navigator.clipboard.writeText(full).catch(function(){});
        const wrap = document.getElementById('detail-sig-link');
        if (wrap) { wrap.style.display = 'block'; wrap.textContent = full; }
        alert('Link copied!\n\n' + full + '\n\nSend this to the customer via text or email.');
      } else {
        alert('Error: ' + (result.error || 'Unknown'));
      }
    })
    .catch(function(){ alert('Could not reach server.'); });
}

function markLinkSent(id, dataArr, btn) {
  fetch('/api/submissions/' + id + '/mark-sent', {
    method: 'POST', headers: {'Content-Type':'application/json'}, body: '{}'
  }).then(function(r){ return r.json(); })
  .then(function(result){
    if (result.success) {
      if (btn) {
        var dt = new Date(result.linkSentAt).toLocaleDateString('en-US',{month:'short',day:'numeric'});
        btn.textContent = '📤 Sent ' + dt;
        btn.disabled = true;
      }
      loadPast();
    } else { alert('Error: '+(result.error||'Unknown')); }
  }).catch(function(){ alert('Could not reach server.'); });
}

function archiveSubmission(id) {
  var confirm_text = prompt('Type ARCHIVE to confirm hiding this submission from your list:');
  if (confirm_text !== 'ARCHIVE') { if(confirm_text !== null) alert('Cancelled — you must type ARCHIVE exactly.'); return; }
  fetch('/api/submissions/' + id + '/archive', {
    method: 'POST', headers: {'Content-Type':'application/json'}, body: '{}'
  }).then(function(r){ return r.json(); })
  .then(function(result){
    if (result.success) { showHome(); loadPast(); }
    else { alert('Error: '+(result.error||'Unknown')); }
  }).catch(function(){ alert('Could not reach server.'); });
}

function openRepEdit(s) {
  if (s.signatureStatus === 'signed') { alert('This receipt has been signed and cannot be edited.'); return; }
  var html = '<div style="padding:16px">' +
    '<h3 style="margin-bottom:16px;color:#1a1a2e">Edit Receipt</h3>' +
    repField('Transaction Amount', 'edit-amount', s.transactionAmount||'') +
    repField('Payment Method', 'edit-payMethod', s.paymentMethod||'') +
    repField('Card Last 4', 'edit-cardLast4', s.cardLast4||'') +
    repField('Card Exp (MM/YY)', 'edit-cardExp', s.cardExp||'') +
    repField('Payment # ', 'edit-payNum', s.paymentNum||'1') +
    repField('of #', 'edit-payOf', s.paymentOf||'1') +
    repField('Payment Plan / Notes', 'edit-payPlan', s.paymentPlan||'') +
    repField('Rebate / Discount', 'edit-rebate', s.rebateDiscount||'') +
    repField('Customer Email', 'edit-email', s.customerEmail||'') +
    repField('Customer Address', 'edit-address', s.customerAddress||'') +
    repField('Customer City/State/ZIP', 'edit-city', s.customerCity||'') +
    repField('Sales Notes (internal)', 'edit-notes', s.salesNotes||'') +
    '<p style="font-size:11px;color:#aaa;margin-top:8px">Locked: Customer name, products, company, sale date</p>' +
    '<div style="display:flex;gap:10px;margin-top:16px">' +
    '<button onclick="saveRepEdit(\'' + s.id + '\',\'' + encodeURIComponent(s.salesRep||'Rep') + '\')" style="flex:2;padding:12px;background:#2c2c2c;color:#e0c97a;border:none;border-radius:8px;font-weight:700;cursor:pointer">💾 Save Changes</button>' +
    '<button onclick="showHome()" style="flex:1;padding:12px;background:transparent;border:1.5px solid #dde1e7;border-radius:8px;cursor:pointer">Cancel</button>' +
    '</div></div>';
  document.getElementById('form-wrap').innerHTML = html;
  document.getElementById('view-form').style.display = 'block';
  document.getElementById('view-home').style.display = 'none';
  document.getElementById('view-detail').style.display = 'none';
}

function repField(label, id, val) {
  return '<div style="margin-bottom:12px"><label style="display:block;font-size:11px;font-weight:600;color:#888;text-transform:uppercase;margin-bottom:4px">' + label + '</label>' +
    '<input id="' + id + '" value="' + val.replace(/"/g,'&quot;') + '" style="width:100%;padding:10px 12px;border:1.5px solid #dde1e7;border-radius:8px;font-size:14px"></div>';
}

function saveRepEdit(id, repName) {
  var updated = {
    editedBy: repName,
    transactionAmount: document.getElementById('edit-amount').value,
    paymentMethod: document.getElementById('edit-payMethod').value,
    cardLast4: document.getElementById('edit-cardLast4').value,
    cardExp: document.getElementById('edit-cardExp').value,
    paymentNum: document.getElementById('edit-payNum').value,
    paymentOf: document.getElementById('edit-payOf').value,
    paymentPlan: document.getElementById('edit-payPlan').value,
    rebateDiscount: document.getElementById('edit-rebate').value,
    customerEmail: document.getElementById('edit-email').value,
    customerAddress: document.getElementById('edit-address').value,
    customerCity: document.getElementById('edit-city').value,
    salesNotes: document.getElementById('edit-notes').value,
  };
  fetch('/api/submissions/' + id + '/rep-edit', {
    method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify(updated)
  }).then(function(r){ return r.json(); })
  .then(function(result){
    if (result.success) { alert('Saved!'); showHome(); loadPast(); }
    else { alert('Error: '+(result.error||'Unknown')); }
  }).catch(function(){ alert('Could not reach server.'); });
}

function goRepHome() {
  // Go to rep page if logged in, otherwise home
  var user = JSON.parse(localStorage.getItem('rp_user') || '{}');
  if (user.role === 'rep') window.location.href = '/rep';
  else if (user.role === 'superadmin') window.location.href = '/dashboard';
  else showHome();
}

function esc(str) {
  return String(str||'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── Past Submissions ──────────────────────────────────────
let allPast = [];

async function showPast() {
  document.getElementById('section-past').style.display = 'block';
  document.getElementById('past-list').innerHTML = '<p style="color:#aaa;font-size:13px;padding:12px 0">Loading...</p>';
  try {
    const res = await fetch('/api/submissions');
    allPast = await res.json();
    renderPast(allPast);
  } catch (e) {
    document.getElementById('past-list').innerHTML = '<p style="color:#e74c3c;font-size:13px;padding:12px 0">Could not load. Is the server running?</p>';
  }
}

function hidePast() {
  document.getElementById('section-past').style.display = 'none';
}

function filterPast() {
  const q = document.getElementById('past-search').value.toLowerCase();
  renderPast(allPast.filter(s => (s.customerName||'').toLowerCase().includes(q)));
}

function renderPast(data) {
  const list = document.getElementById('past-list');
  if (!data.length) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>No submissions found.</p></div>';
    return;
  }
  list.innerHTML = data.map((s, i) => {
    const safeName = (s.customerName||'Unknown').replace(/[^a-z0-9]/gi,'_');
    const filename = s.timestamp.slice(0,10) + '_' + safeName + '_' + s.id + '.pdf';
    const date = new Date(s.timestamp).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
    return `
      <div class="session-item" onclick="showPastDetail(${i}, allPast)">
        <div class="session-info">
          <div class="session-name">
            ${esc(s.customerName||'—')}
            <span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;margin-left:6px;background:${(s.signatureStatus||'unsigned')==='signed'?'#d4edda':(s.signatureStatus||'unsigned')==='sent'?'#fff3cd':'#f0f0f0'};color:${(s.signatureStatus||'unsigned')==='signed'?'#155724':(s.signatureStatus||'unsigned')==='sent'?'#856404':'#888'}">${((s.signatureStatus||'unsigned').charAt(0).toUpperCase()+(s.signatureStatus||'unsigned').slice(1))}</span>
            ${s.linkSentAt?'<span style="font-size:10px;color:#aaa;margin-left:4px">📤 '+new Date(s.linkSentAt).toLocaleDateString('en-US',{month:'short',day:'numeric'})+'</span>':''}
          </div>
          <div class="session-meta">${esc(s.saleCompany||'—')} &nbsp;·&nbsp; ${esc(s.transactionAmount||'—')} &nbsp;·&nbsp; ${date}</div>
          <div class="session-products">${esc((s.products||[]).join(', '))}</div>
        </div>
        <div class="session-actions" onclick="event.stopPropagation()">
          <a class="btn-small-pdf" href="/api/pdf/${s.id}" target="_blank">⬇ Signed PDF</a>
          <a class="btn-small-pdf" href="/api/pdf/original/${s.id}" target="_blank" style="background:#555">📄 Unsigned PDF</a>
          <button class="btn-small-dup" style="font-size:11px" onclick="markLinkSent('${s.id}', allPast, this)" ${s.linkSentAt?'disabled':''}>${s.linkSentAt?'📤 Sent '+new Date(s.linkSentAt).toLocaleDateString('en-US',{month:'short',day:'numeric'}):'📤 Mark Sent'}</button>
          <button class="btn-small-dup" onclick="showForm('${esc(JSON.stringify(s))}')">Duplicate</button>
        </div>
      </div>`;
  }).join('');
}

function showPastDetail(index, dataArr) {
  const s = dataArr[index];
  if (!s) return;
  const safeName = (s.customerName||'Unknown').replace(/[^a-z0-9]/gi,'_');
  const filename = s.timestamp.slice(0,10) + '_' + safeName + '_' + s.id + '.pdf';
  const date = new Date(s.timestamp).toLocaleString('en-US', {
    month:'long', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit'
  });

  document.getElementById('view-home').style.display   = 'none';
  document.getElementById('view-form').style.display   = 'none';
  document.getElementById('view-detail').style.display = 'block';

  document.getElementById('detail-body').innerHTML = `
    <div class="detail-row"><span class="detail-label">Sales Rep</span><span>${esc(s.salesRep||'—')}</span></div>
    <div class="detail-row"><span class="detail-label">Customer</span><span>${esc(s.customerName||'—')}</span></div>
    <div class="detail-row"><span class="detail-label">Address</span><span>${esc(s.customerAddress||'—')}</span></div>
    <div class="detail-row"><span class="detail-label">City / ZIP</span><span>${esc(s.customerCity||'—')}</span></div>
    <div class="detail-row"><span class="detail-label">Email</span><span>${esc(s.customerEmail||'—')}</span></div>
    <div class="detail-row"><span class="detail-label">Company</span><span>${esc(s.saleCompany||'—')}</span></div>
    <div class="detail-row"><span class="detail-label">Products</span><span>${esc((s.products||[]).join(', ')||'—')}</span></div>
    <div class="detail-row"><span class="detail-label">Amount</span><span>${esc(s.transactionAmount||'—')}</span></div>
    <div class="detail-row"><span class="detail-label">Payment</span><span>${esc(s.paymentNum||'1')} of ${esc(s.paymentOf||'1')} · ${esc(s.paymentMethod||'—')}${s.cardLast4?' · xxxx-'+esc(s.cardLast4):''}</span></div>
    <div class="detail-row"><span class="detail-label">Payment Plan</span><span>${esc(s.paymentPlan||'—')}</span></div>
    <div class="detail-row"><span class="detail-label">Rebate</span><span>${esc(s.rebateDiscount||'—')}</span></div>
    <div class="detail-row"><span class="detail-label">Sales Notes</span><span>${esc(s.salesNotes||'—')}</span></div>
    <div class="detail-row"><span class="detail-label">Submitted</span><span>${date}</span></div>
  `;
  document.getElementById('detail-pdf-link').href = '/api/pdf/' + s.id;
  var origLink = document.getElementById('detail-orig-link');
  if (origLink) origLink.href = '/api/pdf/original/' + s.id;
  document.getElementById('detail-dup-btn').onclick = () => showForm(JSON.stringify(s));

  // Edit button - only for unsigned
  var editBtn = document.getElementById('detail-edit-btn');
  if (editBtn) {
    if (s.signatureStatus === 'signed') {
      editBtn.disabled = true;
      editBtn.style.opacity = '0.4';
      editBtn.title = 'Cannot edit a signed receipt';
    } else {
      editBtn.disabled = false;
      editBtn.style.opacity = '1';
      editBtn.onclick = function() { openRepEdit(s); };
    }
  }

  // Archive button
  var archBtn = document.getElementById('detail-archive-btn');
  if (archBtn) {
    archBtn.onclick = function() { archiveSubmission(s.id); };
  }

  // Show last edited info if applicable
  if (s.lastEditedBy && s.lastEditedAt) {
    var editInfo = document.createElement('p');
    editInfo.style.cssText = 'font-size:11px;color:#aaa;padding:4px 16px;margin-top:-4px';
    editInfo.textContent = 'Last edited by ' + s.lastEditedBy + ' on ' + new Date(s.lastEditedAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
    var detailBody = document.getElementById('detail-body');
    if (detailBody) detailBody.appendChild(editInfo);
  }
  // Load signing link
  _detailSigningLink = null;
  var sigBox = document.getElementById('detail-sig-link');
  if (sigBox) {
    if (s.signatureToken) {
      _detailSigningLink = window.location.origin + '/sign/' + s.signatureToken;
      sigBox.textContent = _detailSigningLink;
    } else {
      sigBox.textContent = 'Generating...';
      fetch('/api/send-signature/' + s.id, { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' })
        .then(function(r){ return r.json(); })
        .then(function(result){
          if (result.success) {
            _detailSigningLink = result.signingLink;
            sigBox.textContent = _detailSigningLink;
          } else { sigBox.textContent = 'Could not generate.'; }
        })
        .catch(function(){ sigBox.textContent = 'Error.'; });
    }
  }

  // Show signing link if available
  const sigLinkWrap = document.getElementById('detail-sig-link');
  const sigLinkBtn  = document.getElementById('detail-get-link-btn');
  if (s.signatureStatus === 'signed') {
    if (sigLinkWrap) sigLinkWrap.style.display = 'none';
    if (sigLinkBtn)  sigLinkBtn.textContent = '✅ Already Signed';
  } else if (s.signatureToken) {
    const fullLink = window.location.origin + '/sign/' + s.signatureToken;
    if (sigLinkWrap) { sigLinkWrap.style.display = 'block'; sigLinkWrap.textContent = fullLink; }
    if (sigLinkBtn)  sigLinkBtn.textContent = '🔗 Copy Signing Link';
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}