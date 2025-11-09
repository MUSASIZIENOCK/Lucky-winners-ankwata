// ANKWATA frontend actions
const slotsEl = document.getElementById('slots');
const generateBtn = document.getElementById('generateBtn');
const finalNumberEl = document.getElementById('finalNumber');
const resultBox = document.getElementById('result');
const statusEl = document.getElementById('status');

const SLOT_COUNT = 10;
const AMOUNT = 5000; // UGX, visible but server-side enforces price

for (let i = 0; i < SLOT_COUNT; i++) {
  const d = document.createElement('div');
  d.className = 'digit';
  d.textContent = '-';
  slotsEl.appendChild(d);
}

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

async function spinAndShow(finalDigits) {
  const digits = Array.from(document.querySelectorAll('.digit'));
  const spinDuration = 1800;
  const start = performance.now();
  return new Promise(res => {
    function frame(t) {
      const elapsed = t - start;
      digits.forEach((el, idx) => {
        const jitter = Math.floor(Math.abs(Math.sin((elapsed/20) + idx)) * 9);
        el.textContent = Math.floor((jitter + elapsed/100 + idx) % 10);
      });
      if (elapsed < spinDuration) {
        requestAnimationFrame(frame);
      } else {
        digits.forEach((el, i) => {
          setTimeout(() => {
            el.textContent = finalDigits[i];
            el.style.transform = 'scale(1.08)';
            setTimeout(()=> el.style.transform = 'scale(1)', 140);
          }, i * 90);
        });
        setTimeout(res, digits.length * 90 + 220);
      }
    }
    requestAnimationFrame(frame);
  });
}

async function startPaymentAndPick() {
  generateBtn.disabled = true;
  statusEl.textContent = 'Initializing payment...';
  finalNumberEl.textContent = '----------';
  resultBox.classList.add('hidden');

  try {
    // 1) create payment on server: it will return a tx_ref and possibly an authorization/instruction
    const createResp = await fetch('/api/create-payment', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ amount: AMOUNT })
    });
    const createData = await createResp.json();
    if (!createResp.ok) throw new Error(createData.message || 'Could not create payment');

    const txRef = createData.tx_ref;
    // show any instruction URL (if gateway provides)
    if (createData.payment_instructions) {
      statusEl.innerHTML = 'Follow payment instructions: ' + createData.payment_instructions;
    } else {
      statusEl.textContent = 'Payment request created. Awaiting confirmation...';
    }

    // Polling for demo. Production: use webhooks.
    const startTime = Date.now();
    let confirmed = false;
    while (Date.now() - startTime < 2 * 60 * 1000) { // 2 minutes
      await sleep(3000);
      const check = await fetch('/api/check-payment?tx_ref=' + encodeURIComponent(txRef));
      const checkData = await check.json();
      if (!check.ok) {
        // continue polling (server might still be pending)
      } else if (checkData.status === 'successful') {
        confirmed = true;
        break;
      } else if (checkData.status === 'failed') {
        break;
      }
    }

    if (!confirmed) {
      statusEl.textContent = 'Payment not confirmed. Try again or contact support.';
      generateBtn.disabled = false;
      return;
    }

    statusEl.textContent = 'Payment confirmed. Generating winner...';

    // fetch winner
    const winResp = await fetch('/api/get-winner?tx_ref=' + encodeURIComponent(txRef));
    const winData = await winResp.json();
    if (!winResp.ok) throw new Error(winData.message || 'Could not fetch winner');

    const digits = String(winData.winner).padStart(SLOT_COUNT, '0').split('');
    await spinAndShow(digits);
    finalNumberEl.textContent = digits.join('');
    resultBox.classList.remove('hidden');
    statusEl.textContent = 'Winner announced. Congratulations to the winner!';
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Error: ' + err.message;
    alert('Error: ' + err.message);
  } finally {
    generateBtn.disabled = false;
  }
}

generateBtn.addEventListener('click', startPaymentAndPick);
