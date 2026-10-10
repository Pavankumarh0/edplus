/**
 * The call simulator: a browser page that behaves like a parent's phone.
 *
 * Plain HTML with no build step, served by the voice service itself, because
 * the whole point is to have one fewer thing that can fail during a demo.
 * It drives the real endpoints — the same Sarvam audio, the same Claude turn,
 * the same `log_call_outcome` write — so what a judge sees here is what a real
 * call does, minus the telco.
 */
export function simulatorPage(baseUrl: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>EduPlus call simulator</title>
<style>
  :root {
    --canvas: #F2F0EB; --surface: #FBFAF8; --sunk: #EAE7E0;
    --ink: #121110; --muted: #5C5852; --faint: #8F8A82;
    --hairline: #DDD9D1; --lime: #D9F99D;
    --ok: #195936; --ok-fill: #DCF2E4;
    --bad: #8D1A1A; --bad-fill: #FBDAD9;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px 16px; background: var(--canvas); color: var(--ink);
    font: 400 15px/1.55 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 520px; margin: 0 auto; }
  h1 { font-size: 26px; line-height: 1.25; letter-spacing: -.015em; margin: 0 0 4px; }
  .sub { color: var(--muted); font-size: 13.5px; margin: 0 0 20px; max-width: 46ch; }
  .card {
    background: var(--surface); border: 1px solid var(--hairline);
    border-radius: 24px; padding: 20px; margin-bottom: 16px;
  }
  .phone {
    background: var(--ink); color: var(--canvas); border-radius: 32px;
    padding: 22px; margin-bottom: 16px;
  }
  .phone .who { font-size: 12.5px; opacity: .65; }
  .phone .name { font-size: 20px; font-weight: 600; margin-top: 2px; }
  .phone .state { font-size: 13px; opacity: .75; margin-top: 6px; }
  label { display: block; font-size: 12.5px; font-weight: 560; color: var(--muted); margin-bottom: 6px; }
  select, input[type=text] {
    width: 100%; min-height: 42px; padding: 0 10px; font: inherit;
    border: 1px solid var(--hairline); border-radius: 10px; background: #fff;
  }
  button {
    font: inherit; font-weight: 500; min-height: 42px; padding: 0 16px;
    border-radius: 10px; border: 1px solid transparent; cursor: pointer;
    background: var(--ink); color: var(--canvas);
  }
  button.secondary { background: var(--surface); color: var(--ink); border-color: var(--hairline); }
  button:disabled { opacity: .45; cursor: not-allowed; }
  .keys { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 14px; }
  .keys button {
    min-height: 56px; font-size: 17px; font-weight: 600;
    background: var(--sunk); color: var(--ink);
  }
  .keys button:hover:not(:disabled) { background: var(--lime); }
  .keys button span { display: block; font-size: 11px; font-weight: 400; color: var(--muted); }
  .said { margin-top: 14px; }
  .row { display: flex; gap: 8px; margin-top: 8px; }
  .row input { flex: 1; }
  .log { margin-top: 16px; }
  .turn { padding: 10px 12px; border-radius: 12px; margin-bottom: 8px; font-size: 13.5px; }
  .turn.agent { background: var(--sunk); }
  .turn.parent { background: var(--lime); }
  .turn b { display: block; font-size: 11px; font-weight: 560; color: var(--muted); margin-bottom: 2px; }
  .note { font-size: 13px; color: var(--faint); margin-top: 10px; }
  .banner { padding: 10px 12px; border-radius: 10px; font-size: 13.5px; margin-top: 12px; }
  .banner.ok { background: var(--ok-fill); color: var(--ok); }
  .banner.bad { background: var(--bad-fill); color: var(--bad); }
  .hidden { display: none; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Call simulator</h1>
  <p class="sub">
    A stand-in for a parent's phone. This runs the real pipeline &mdash; the same approved
    message, the same Sarvam speech, the same Claude turn, the same record written to
    Firestore. Only the telephone network is missing.
  </p>

  <div class="card">
    <label for="call">Queued call</label>
    <select id="call"><option value="">Loading&hellip;</option></select>
    <div class="row">
      <button id="refresh" class="secondary" type="button">Refresh</button>
      <button id="answer" type="button" disabled>Answer call</button>
    </div>
    <p class="note" id="hint">Approve a parent call in the dashboard and it appears here.</p>
  </div>

  <div class="phone hidden" id="phone">
    <div class="who">Incoming call from the college</div>
    <div class="name" id="parentName">&mdash;</div>
    <div class="state" id="state">Connected</div>
  </div>

  <div class="card hidden" id="controls">
    <audio id="audio" controls style="width:100%"></audio>
    <p class="note" id="audioNote"></p>

    <div class="keys" id="keys"></div>

    <div class="said">
      <label for="say">&hellip;or say something instead (Tier 2)</label>
      <div class="row">
        <input id="say" type="text" placeholder="Who is this? Can you tell me his marks?">
        <button id="send" type="button">Send</button>
      </div>
    </div>

    <div id="banner"></div>
  </div>

  <div class="log" id="log"></div>
</div>

<script>
const BASE = ${JSON.stringify(baseUrl)};
const $ = (id) => document.getElementById(id);
let current = null;

function turn(who, text) {
  const el = document.createElement('div');
  el.className = 'turn ' + who;
  el.innerHTML = '<b>' + (who === 'agent' ? 'Assistant' : 'Parent') + '</b>';
  el.appendChild(document.createTextNode(text));
  $('log').appendChild(el);
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function banner(kind, text) {
  $('banner').innerHTML = '<div class="banner ' + kind + '">' + text + '</div>';
}

async function loadCalls() {
  $('hint').textContent = 'Looking for queued calls\\u2026';
  try {
    const res = await fetch(BASE + '/calls/queued');
    const json = await res.json();
    const select = $('call');
    select.innerHTML = '';
    if (!json.calls.length) {
      select.innerHTML = '<option value="">No queued calls</option>';
      $('answer').disabled = true;
      $('hint').textContent = 'Approve a parent call in the dashboard, then press Refresh.';
      return;
    }
    for (const call of json.calls) {
      const option = document.createElement('option');
      option.value = call.callId;
      option.textContent = call.usn + ' \\u00b7 ' + call.purpose + ' \\u00b7 ' + call.language;
      select.appendChild(option);
    }
    $('answer').disabled = false;
    $('hint').textContent = json.calls.length + ' call(s) waiting.';
  } catch (err) {
    $('hint').textContent = 'Could not reach the voice service.';
  }
}

function renderKeys(purpose) {
  const sets = {
    ptm: [['1','Can attend'],['2','Cannot attend'],['9','Call me back']],
    absence: [['1','Understood'],['9','Call me back']],
    risk_update: [['1','Understood'],['9','Call me back']]
  };
  const keys = sets[purpose] || sets.absence;
  $('keys').innerHTML = '';
  for (const [digit, label] of keys) {
    const button = document.createElement('button');
    button.type = 'button';
    button.innerHTML = digit + '<span>' + label + '</span>';
    button.onclick = () => reply({ digit });
    $('keys').appendChild(button);
  }
}

function playAudio(path) {
  if (path) {
    $('audio').src = BASE + path;
    $('audio').classList.remove('hidden');
    $('audioNote').textContent = 'Generated by Sarvam in the parent\\u2019s language.';
    $('audio').play().catch(() => {});
  } else {
    $('audio').classList.add('hidden');
    $('audioNote').textContent = 'Sarvam audio unavailable \\u2014 showing the text only.';
  }
}

$('refresh').onclick = loadCalls;

$('answer').onclick = async () => {
  const callId = $('call').value;
  if (!callId) return;
  $('answer').disabled = true;
  $('log').innerHTML = '';
  $('banner').innerHTML = '';
  try {
    const res = await fetch(BASE + '/simulator/start', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ callId })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error);
    current = json;
    $('phone').classList.remove('hidden');
    $('controls').classList.remove('hidden');
    $('parentName').textContent = json.parentName;
    $('state').textContent = 'Connected \\u00b7 ' + json.language;
    renderKeys(json.purpose);
    playAudio(json.audioPath);
    turn('agent', json.say);
  } catch (err) {
    banner('bad', err.message || 'Could not start the call.');
    $('answer').disabled = false;
  }
};

async function reply(payload) {
  if (!current) return;
  if (payload.said) turn('parent', payload.said);
  else turn('parent', 'pressed ' + payload.digit);

  try {
    const res = await fetch(BASE + '/simulator/reply', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ callId: current.callId, ...payload })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error);

    turn('agent', json.say);
    playAudio(json.audioPath);

    if (json.finished) {
      $('state').textContent = 'Call ended';
      banner('ok', 'Outcome recorded' + (json.outcome ? ': ' + json.outcome : '') +
        '. It is on the student\\u2019s timeline in the dashboard.');
      $('keys').querySelectorAll('button').forEach(b => b.disabled = true);
      $('send').disabled = true;
      $('answer').disabled = false;
      loadCalls();
    }
  } catch (err) {
    banner('bad', err.message || 'The call failed.');
  }
}

$('send').onclick = () => {
  const said = $('say').value.trim();
  if (!said) return;
  $('say').value = '';
  reply({ said });
};
$('say').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('send').click(); });

loadCalls();
</script>
</body>
</html>`;
}
